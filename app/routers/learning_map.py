"""Authenticated chapter and node learning-map APIs."""
from __future__ import annotations

from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from app.auth.dependencies import require_user_id
from app.auth.jwt_handler import decode_token
from app.db import kg_v44
from app.db.chat_history_db import get_chat_history
from app.db.evidence_db import list_evidence_for_user
from app.services.learning.projection import is_blocked, project_status

router = APIRouter(prefix="/api/learning-map", tags=["学习地图"])


def _kg_call(func, *args, **kwargs):
    try:
        return func(*args, **kwargs)
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"code": "map_unavailable", "message": "学习地图暂时不可用"}) from exc


@router.get("/chapters")
def chapters(textbook_id: str, authorization: Optional[str] = Header(None)):
    user_id = require_user_id(authorization, decoder=decode_token)
    chapter_rows = _kg_call(kg_v44.list_kg_chapter_nodes, textbook_id)
    evidence = list_evidence_for_user(user_id, textbook_id=textbook_id)
    by_node: dict[str, list[dict]] = defaultdict(list)
    for row in evidence:
        by_node[row["node_id"]].append(row)
    result = []
    for item in chapter_rows:
        chapter = item["chapter"]
        node_ids = item.get("node_ids") or []
        counts = defaultdict(int)
        for node_id in node_ids:
            status = project_status(by_node.get(node_id, []))
            counts[status] += 1
        total = len(node_ids) or int(item.get("node_count") or 0)
        explored = sum(1 for node_id in node_ids if by_node.get(node_id))
        result.append({
            "chapter": chapter,
            "node_count": total,
            "status_counts": {key: counts[key] for key in ("unexplored", "learning", "basically_mastered", "mastered", "needs_review")},
            "exploration_progress": {"explored": explored, "total": total},
        })
    return {"textbook_id": textbook_id, "chapters": result}


@router.get("/nodes")
def nodes(textbook_id: str, chapter: str, authorization: Optional[str] = Header(None)):
    user_id = require_user_id(authorization, decoder=decode_token)
    raw_nodes = _kg_call(kg_v44.list_kg_nodes, textbook_id, chapter)
    evidence = list_evidence_for_user(user_id, textbook_id=textbook_id)
    by_node: dict[str, list[dict]] = defaultdict(list)
    for row in evidence:
        by_node[row["node_id"]].append(row)
    status_by_id = {node_id: project_status(rows) for node_id, rows in by_node.items()}
    for node in raw_nodes:
        status_by_id.setdefault(node["node_id"], "unexplored")
    groups: dict[str, list[dict]] = defaultdict(list)
    for node in raw_nodes:
        node_id = node["node_id"]
        rows = by_node.get(node_id, [])
        latest_chat_id = next((row.get("chat_id") for row in reversed(rows) if row.get("chat_id")), None)
        chat_exists = bool(latest_chat_id and get_chat_history(user_id, chat_id=latest_chat_id))
        prereq_statuses = [status_by_id.get(pid, "unexplored") for pid in (node.get("prerequisite_ids") or [])]
        item = {
            "node_id": node_id, "name": node.get("name"), "type": node.get("type"),
            "section": node.get("section") or "未分节", "status": status_by_id[node_id],
            "closed_evidence_count": sum(row.get("outcome") in {"independent", "assisted", "direct_taught"} for row in rows),
            "blocked": status_by_id[node_id] != "needs_review" and is_blocked(prereq_statuses),
            "chat": {"id": latest_chat_id, "available": chat_exists},
        }
        groups[item["section"]].append(item)
    return {"textbook_id": textbook_id, "chapter": chapter, "sections": [{"section": key, "nodes": value} for key, value in groups.items()]}
