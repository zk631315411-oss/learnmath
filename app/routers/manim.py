"""Manim artifact status and protected media endpoints."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query
from fastapi.responses import FileResponse

from app.auth.jwt_handler import decode_token
from app.db.manim_artifact_db import (
    claim_artifact_status,
    get_artifact,
    list_artifacts_for_chat,
    update_artifact,
)
from app.services.manim_queue import (
    artifact_response,
    clear_artifact_files,
    enqueue_artifact,
    reconcile_artifact,
    validate_media_token,
)
from app.services.manim_repair import repair_artifact_once

router = APIRouter(prefix="/api/manim", tags=["数学动画"])


def _user(authorization: str | None) -> str:
    if not authorization or len(authorization.split()) != 2:
        raise HTTPException(status_code=401, detail="缺少认证令牌")
    try:
        user_id = decode_token(authorization.split()[1]).get("user_id")
    except Exception as exc:
        raise HTTPException(status_code=401, detail="无效的认证令牌") from exc
    if not user_id:
        raise HTTPException(status_code=401, detail="无效的认证令牌")
    return str(user_id)


def _schedule_repair(artifact: dict, background_tasks: BackgroundTasks) -> None:
    if artifact.get("status") == "repair_pending":
        background_tasks.add_task(repair_artifact_once, artifact["id"])


@router.get("/artifacts")
def artifacts_for_chat(
    background_tasks: BackgroundTasks,
    chat_id: str = Query(..., min_length=1, max_length=128),
    authorization: str | None = Header(None),
):
    user_id = _user(authorization)
    result = []
    for item in list_artifacts_for_chat(chat_id, user_id):
        artifact = reconcile_artifact(item)
        _schedule_repair(artifact, background_tasks)
        result.append(artifact_response(artifact))
    return result


@router.get("/artifacts/{artifact_id}")
def artifact_status(
    artifact_id: str,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(None),
):
    try:
        artifact = reconcile_artifact(get_artifact(artifact_id, _user(authorization)))
        _schedule_repair(artifact, background_tasks)
        return artifact_response(artifact)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="动画不存在") from exc


@router.post("/artifacts/{artifact_id}/retry")
def retry_artifact(artifact_id: str, authorization: str | None = Header(None)):
    user_id = _user(authorization)
    try:
        artifact = get_artifact(artifact_id, user_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="动画不存在") from exc
    artifact = reconcile_artifact(artifact)
    if artifact.get("status") != "failed":
        raise HTTPException(status_code=409, detail="只有失败的动画可以重试")
    if not claim_artifact_status(artifact_id, "failed", "queued"):
        raise HTTPException(status_code=409, detail="动画状态已变化")
    clear_artifact_files(artifact_id)
    update_artifact(
        artifact_id, repair_count=0, error_code="", error_message="", clear_rq_job_id=True,
    )
    try:
        enqueue_artifact(artifact_id)
    except RuntimeError:
        pass
    return artifact_response(get_artifact(artifact_id, user_id))


@router.get("/artifacts/{artifact_id}/media/{kind}")
def artifact_media(artifact_id: str, kind: str, token: str = ""):
    if kind not in {"video", "poster"}:
        raise HTTPException(status_code=404, detail="媒体类型不存在")
    user_id = validate_media_token(artifact_id, token)
    if not user_id:
        raise HTTPException(status_code=401, detail="媒体地址无效或已过期")
    try:
        artifact = get_artifact(artifact_id, user_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="动画不存在") from exc
    path = artifact.get("video_path" if kind == "video" else "poster_path")
    if not path or not Path(path).is_file():
        raise HTTPException(status_code=404, detail="动画媒体尚未生成")
    return FileResponse(path, media_type="video/mp4" if kind == "video" else "image/png")
