"""Read-only student model APIs (Phase 3, opt-in)."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query

from app.auth.dependencies import require_user_id
from app.auth.jwt_handler import decode_token
from app.services.learning.catalog import catalog_version, get_catalog_entry, get_catalog_node
from app.services.learning.learner_model_service import (
    get_public_model,
    get_public_node,
)


router = APIRouter(prefix="/api/learner-model", tags=["学生模型"])


def _validate_textbook(textbook_id: str) -> tuple[str, str]:
    clean = str(textbook_id or "").strip()
    try:
        entry = get_catalog_entry(clean)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="学习目录尚未生成") from exc
    if not entry:
        raise HTTPException(status_code=400, detail="未知教材")
    return clean, catalog_version(clean)


@router.get("")
def learner_model(
    textbook_id: str,
    authorization: Optional[str] = Header(None),
    debug: bool = Query(False),
):
    user_id = require_user_id(authorization, decoder=decode_token)
    clean, _ = _validate_textbook(textbook_id)
    return get_public_model(user_id, clean, debug=debug)


@router.get("/nodes/{node_id:path}")
def learner_model_node(
    node_id: str,
    textbook_id: str,
    authorization: Optional[str] = Header(None),
    debug: bool = Query(False),
):
    user_id = require_user_id(authorization, decoder=decode_token)
    clean, _ = _validate_textbook(textbook_id)
    clean_node = str(node_id or "").strip()
    if not clean_node.startswith(f"{clean}:") or get_catalog_node(clean, clean_node) is None:
        raise HTTPException(status_code=400, detail="节点不属于当前教材")
    return get_public_node(user_id, clean, clean_node, debug=debug)
