"""Authenticated sparse learning-progress API."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from app.auth.dependencies import require_user_id
from app.auth.jwt_handler import decode_token
from app.services.learning.catalog import get_catalog_entry
from app.services.learning.progress import project_user_progress


router = APIRouter(prefix="/api/learning-progress", tags=["学习进度"])


@router.get("")
def learning_progress(textbook_id: str, authorization: Optional[str] = Header(None)):
    user_id = require_user_id(authorization, decoder=decode_token)
    clean_textbook = str(textbook_id or "").strip()
    try:
        entry = get_catalog_entry(clean_textbook)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="学习目录尚未生成") from exc
    if not entry:
        raise HTTPException(status_code=400, detail="未知教材")
    return project_user_progress(user_id, clean_textbook)
