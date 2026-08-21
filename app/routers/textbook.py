"""Read-only textbook navigation helpers."""
from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from app.auth.dependencies import require_user_id
from app.auth.jwt_handler import decode_token
from app.services.learning.section_page import resolve_section_page
from app.textbooks import TEXTBOOK_LABELS

router = APIRouter(prefix="/api/textbook", tags=["教材"])
_SECTION_RE = re.compile(r"^\d+(?:\.\d+)*$")


@router.get("/section-page")
def section_page(textbook_id: str, section: str, authorization: Optional[str] = Header(None)):
    require_user_id(authorization, decoder=decode_token)
    clean_textbook = textbook_id.strip().lower()
    clean_section = section.strip()
    if clean_textbook not in TEXTBOOK_LABELS:
        raise HTTPException(status_code=400, detail="未知教材")
    if not _SECTION_RE.fullmatch(clean_section):
        raise HTTPException(status_code=400, detail="section 必须是数字前缀，例如 3.1")
    return resolve_section_page(clean_textbook, clean_section)
