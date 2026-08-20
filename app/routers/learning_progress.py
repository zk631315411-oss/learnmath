"""Authenticated sparse learning-progress API."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from app.auth.jwt_handler import decode_token
from app.services.learning.catalog import get_catalog_entry
from app.services.learning.progress import project_user_progress


router = APIRouter(prefix="/api/learning-progress", tags=["学习进度"])


def _require_user(authorization: Optional[str]) -> str:
    parts = (authorization or "").split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="未登录或token无效")
    try:
        user_id = decode_token(parts[1]).get("user_id")
    except Exception as exc:
        raise HTTPException(status_code=401, detail="未登录或token无效") from exc
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录或token无效")
    return str(user_id)


@router.get("")
def learning_progress(textbook_id: str, authorization: Optional[str] = Header(None)):
    user_id = _require_user(authorization)
    clean_textbook = str(textbook_id or "").strip()
    try:
        entry = get_catalog_entry(clean_textbook)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="学习目录尚未生成") from exc
    if not entry:
        raise HTTPException(status_code=400, detail="未知教材")
    return project_user_progress(user_id, clean_textbook)
