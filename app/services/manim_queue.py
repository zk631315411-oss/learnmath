"""API-side Manim queue and artifact lifecycle coordination."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import shutil
import time
from pathlib import Path
from urllib.parse import quote

from app.config import config
from app.db.manim_artifact_db import (
    count_active_artifacts,
    get_artifact,
    list_active_artifacts,
    update_artifact,
)


def enqueue_artifact(artifact_id: str) -> str:
    """Send source to the trusted dispatcher; the renderer never connects to Redis."""
    try:
        from redis import Redis
        from rq import Queue

        artifact = get_artifact(artifact_id)
        if count_active_artifacts(exclude_id=artifact_id) >= config.MANIM_MAX_QUEUE:
            update_artifact(
                artifact_id, status="failed", error_code="busy", error_message="动画渲染队列已满",
            )
            raise RuntimeError("动画渲染队列已满")
        connection = Redis.from_url(config.MANIM_REDIS_URL)
        connection.ping()
        queue = Queue(config.MANIM_QUEUE, connection=connection)
        job = queue.enqueue(
            "app.workers.manim_dispatcher.dispatch_manim_artifact",
            artifact_id,
            artifact["source_code"],
            float(artifact.get("duration_seconds") or config.MANIM_MAX_DURATION_SECONDS),
            str(artifact.get("quality") or "low"),
            job_timeout=15,
            result_ttl=3600,
            failure_ttl=86400,
        )
        update_artifact(artifact_id, rq_job_id=str(job.id))
        return str(job.id)
    except RuntimeError:
        raise
    except Exception as exc:
        update_artifact(
            artifact_id,
            status="failed",
            error_code="queue_unavailable",
            error_message=_safe_error(exc),
        )
        raise RuntimeError("动画渲染服务当前不可用") from exc


def artifact_response(artifact: dict) -> dict:
    media_token = _media_token(artifact["id"], artifact["user_id"])
    return {
        "id": artifact["id"],
        "chat_id": artifact.get("chat_id"),
        "client_turn_id": artifact.get("client_turn_id"),
        "title": artifact["title"],
        "rationale": artifact.get("rationale") or "",
        "status": artifact["status"],
        "attempt": int(artifact.get("attempt") or 0),
        "repair_count": int(artifact.get("repair_count") or 0),
        "error_code": artifact.get("error_code") or None,
        "error_message": _public_error_message(artifact) if artifact.get("status") == "failed" else None,
        "video_url": (
            f"/api/manim/artifacts/{artifact['id']}/media/video?token={quote(media_token)}"
            if artifact.get("video_path") else None
        ),
        "poster_url": (
            f"/api/manim/artifacts/{artifact['id']}/media/poster?token={quote(media_token)}"
            if artifact.get("poster_path") else None
        ),
        "created_at": artifact.get("created_at"),
        "updated_at": artifact.get("updated_at"),
    }


def reconcile_artifact(artifact: dict) -> dict:
    """Reconcile file-spool state first, then dispatcher failures from RQ."""
    if artifact.get("status") not in {"queued", "running"}:
        return artifact

    result = _read_result(artifact["id"])
    if result is not None:
        attempt = int(artifact.get("attempt") or 0) + 1
        if result.get("status") == "completed":
            video = _validated_output_path(artifact["id"], result.get("video_file"), "animation.mp4")
            poster = _validated_output_path(artifact["id"], result.get("poster_file"), "poster.png")
            if video:
                return update_artifact(
                    artifact["id"], status="completed", attempt=attempt,
                    video_path=str(video), poster_path=str(poster or ""),
                    error_code="", error_message="",
                )
            result = {"status": "failed", "error_code": "missing_output", "error_message": "动画输出文件不存在"}

        code = str(result.get("error_code") or "render_failed")[:80]
        detail = str(result.get("error_message") or "动画渲染失败")[-500:]
        retryable = code == "render_failed" and int(artifact.get("repair_count") or 0) < 1
        return update_artifact(
            artifact["id"], status="repair_pending" if retryable else "failed", attempt=attempt,
            error_code=code, error_message=detail,
        )

    if (config.MANIM_SPOOL_DIR / "running" / f"{artifact['id']}.json").is_file():
        if artifact["status"] != "running":
            return update_artifact(artifact["id"], status="running")
        return artifact

    if not artifact.get("rq_job_id"):
        return artifact
    try:
        from redis import Redis
        from rq.job import Job

        job = Job.fetch(artifact["rq_job_id"], connection=Redis.from_url(config.MANIM_REDIS_URL))
        raw = job.get_status(refresh=True)
        status = getattr(raw, "value", str(raw)).lower()
        if status in {"failed", "stopped", "canceled", "cancelled"}:
            detail = (job.exc_info or "动画任务投递失败").strip().splitlines()[-1][-500:]
            return update_artifact(
                artifact["id"], status="failed", error_code="dispatch_failed", error_message=detail,
            )
    except Exception:
        return artifact
    return artifact


# 后台对账间隔（秒）。渲染结果由无网络的 renderer 写入文件 spool，
# 必须有人周期性把 results/ 回写到 SQLite，否则状态会滞留 queued/running。
RECONCILE_INTERVAL_SECONDS = 2.0


async def reconcile_active_artifacts_loop(stop_event) -> None:
    """Periodically flush file-spool render results into SQLite and drive repair.

    The renderer cannot reach the database (network-disabled), so without this
    loop an artifact's status only advances when a client happens to poll it.
    It also drives the one-shot LLM repair for repair_pending artifacts, which
    is otherwise only triggered when the frontend polls the artifact endpoint.
    """
    import asyncio
    import logging

    logger = logging.getLogger("learnmath.manim.reconcile")
    while not stop_event.is_set():
        try:
            for artifact in list_active_artifacts():
                updated = reconcile_artifact(artifact)
                if updated.get("status") == "repair_pending":
                    from app.services.manim_repair import repair_artifact_once
                    await asyncio.to_thread(repair_artifact_once, artifact["id"])
        except Exception:  # 单次对账失败不应终止后台循环
            logger.exception("manim reconcile pass failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=RECONCILE_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            pass


def clear_artifact_files(artifact_id: str, *, permanent: bool = False) -> None:
    """Remove only paths derived from a server-generated artifact id."""
    output_dir = (config.MANIM_RENDER_DIR / artifact_id).resolve()
    render_root = config.MANIM_RENDER_DIR.resolve()
    if output_dir.parent == render_root and output_dir.is_dir():
        try:
            shutil.rmtree(output_dir)
        except OSError:
            # Production API mounts this volume read-only. A retry overwrites the
            # fixed filenames; permanent deletion is handled by the renderer below.
            pass
    for folder in ("pending", "running", "results"):
        path = config.MANIM_SPOOL_DIR / folder / f"{artifact_id}.json"
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            pass
    if permanent:
        deletions = config.MANIM_SPOOL_DIR / "deletions"
        deletions.mkdir(parents=True, exist_ok=True)
        (deletions / f"{artifact_id}.delete").touch(exist_ok=True)


def _read_result(artifact_id: str) -> dict | None:
    path = config.MANIM_SPOOL_DIR / "results" / f"{artifact_id}.json"
    try:
        if path.stat().st_size > 32_768:
            return {"status": "failed", "error_code": "invalid_result", "error_message": "渲染结果无效"}
        result = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(result, dict) or result.get("artifact_id") != artifact_id:
            raise ValueError("invalid result")
        return result
    except FileNotFoundError:
        return None
    except (OSError, ValueError, json.JSONDecodeError):
        return {"status": "failed", "error_code": "invalid_result", "error_message": "渲染结果无效"}


def _validated_output_path(artifact_id: str, raw_name: object, expected_name: str) -> Path | None:
    if not raw_name or str(raw_name) != expected_name:
        return None
    try:
        expected_parent = (config.MANIM_RENDER_DIR / artifact_id).resolve()
        path = (expected_parent / expected_name).resolve()
        if path.parent != expected_parent or not path.is_file():
            return None
        return path
    except OSError:
        return None


def _media_token(artifact_id: str, user_id: str, *, ttl_seconds: int = 3600) -> str:
    expires = int(time.time()) + ttl_seconds
    payload = f"{artifact_id}:{user_id}:{expires}"
    signature = hmac.new(config.JWT_SECRET.encode(), payload.encode(), hashlib.sha256).digest()
    encoded = base64.urlsafe_b64encode(signature).decode().rstrip("=")
    return f"{user_id}.{expires}.{encoded}"


def validate_media_token(artifact_id: str, token: str) -> str | None:
    try:
        user_id, expires_text, signature = token.split(".", 2)
        expires = int(expires_text)
    except (ValueError, TypeError):
        return None
    if expires < int(time.time()):
        return None
    payload = f"{artifact_id}:{user_id}:{expires}"
    expected = base64.urlsafe_b64encode(
        hmac.new(config.JWT_SECRET.encode(), payload.encode(), hashlib.sha256).digest()
    ).decode().rstrip("=")
    return user_id if hmac.compare_digest(signature, expected) else None


def _safe_error(exc: Exception) -> str:
    text = str(exc).strip() or exc.__class__.__name__
    return text[-500:]


def _public_error_message(artifact: dict) -> str:
    code = str(artifact.get("error_code") or "")
    messages = {
        "busy": "当前动画任务较多，请稍后重试。",
        "queue_unavailable": "动画渲染服务暂时不可用，请稍后重试。",
        "dispatch_failed": "动画任务未能提交，请稍后重试。",
        "render_failed": "动画场景执行失败，文字与公式回答仍可正常使用。",
        "repair_failed": "动画自动修复后仍未能生成，可手动重试。",
        "repair_exhausted": "动画自动修复次数已用完，可手动重试。",
        "timeout": "动画渲染超过 90 秒限制。",
        "duration_exceeded": "动画时长超过 12 秒限制。",
        "output_too_large": "动画文件超过大小限制。",
        "missing_output": "动画未生成有效视频。",
        "invalid_result": "动画渲染结果无效。",
        "renderer_error": "动画渲染进程异常结束。",
    }
    return messages.get(code, "动画未能生成，文字与公式回答仍可正常使用。")
