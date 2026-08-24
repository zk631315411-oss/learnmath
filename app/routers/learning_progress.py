"""Authenticated sparse learning-progress API."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header

from app.auth.dependencies import require_user_id
from app.auth.jwt_handler import decode_token
from app.routers.helpers import resolve_textbook
from app.services.learning.progress import project_user_progress


router = APIRouter(prefix="/api/learning-progress", tags=["学习进度"])


@router.get("")
def learning_progress(textbook_id: str, authorization: Optional[str] = Header(None)):
    user_id = require_user_id(authorization, decoder=decode_token)
    clean_textbook = resolve_textbook(textbook_id)
    return project_user_progress(user_id, clean_textbook)
