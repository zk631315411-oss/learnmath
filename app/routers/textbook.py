"""Read-only textbook navigation helpers."""
from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from app.auth.jwt_handler import decode_token
from app.services.learning.section_page import resolve_section_page
from app.textbooks import TEXTBOOK_LABELS

router = APIRouter(prefix="/api/textbook", tags=["教材"])
_SECTION_RE = re.compile(r"^\d+(?:\.\d+)*$")


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


@router.get("/section-page")
def section_page(textbook_id: str, section: str, authorization: Optional[str] = Header(None)):
    _require_user(authorization)
    clean_textbook = textbook_id.strip().lower()
    clean_section = section.strip()
    if clean_textbook not in TEXTBOOK_LABELS:
        raise HTTPException(status_code=400, detail="未知教材")
    if not _SECTION_RE.fullmatch(clean_section):
        raise HTTPException(status_code=400, detail="section 必须是数字前缀，例如 3.1")
    return resolve_section_page(clean_textbook, clean_section)
