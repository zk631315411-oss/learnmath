"""Read-only student model APIs (Phase 3, production-enabled by default)."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query

from app.auth.dependencies import require_user_id
from app.auth.jwt_handler import decode_token
from app.routers.helpers import resolve_textbook
from app.services.learning.catalog import get_catalog_node
from app.services.learning.learner_model_service import (
    get_public_model,
    get_public_node,
)


router = APIRouter(prefix="/api/learner-model", tags=["学生模型"])


@router.get("")
def learner_model(
    textbook_id: str,
    authorization: Optional[str] = Header(None),
    debug: bool = Query(False),
):
    user_id = require_user_id(authorization, decoder=decode_token)
    clean = resolve_textbook(textbook_id)
    return get_public_model(user_id, clean, debug=debug)


@router.get("/nodes/{node_id:path}")
def learner_model_node(
    node_id: str,
    textbook_id: str,
    authorization: Optional[str] = Header(None),
    debug: bool = Query(False),
):
    user_id = require_user_id(authorization, decoder=decode_token)
    clean = resolve_textbook(textbook_id)
    clean_node = str(node_id or "").strip()
    if not clean_node.startswith(f"{clean}:") or get_catalog_node(clean, clean_node) is None:
        raise HTTPException(status_code=400, detail="节点不属于当前教材")
    return get_public_node(user_id, clean, clean_node, debug=debug)
