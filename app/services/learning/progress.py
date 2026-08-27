"""Project sparse per-user learning progress without accessing Neo4j."""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable

from app.db.evidence_db import (
    get_learning_progress_revision,
    list_evidence_for_user,
    list_evidence_for_user_textbook_nodes,
)
from app.services.learning.catalog import catalog_version
from app.services.learning.projection import CLOSED_OUTCOMES, project_status


def project_user_progress(
    user_id: str,
    textbook_id: str,
    *,
    node_ids: Iterable[str] | None = None,
) -> dict[str, Any]:
    selected = (
        {str(node_id).strip() for node_id in node_ids if str(node_id).strip()}
        if node_ids is not None
        else None
    )
    by_node: dict[str, list[dict[str, Any]]] = defaultdict(list)
    if selected is None:
        evidence_rows = list_evidence_for_user(user_id, textbook_id=textbook_id)
    elif not selected:
        evidence_rows = []
    else:
        # Prerequisite and node-detail callers usually request a small set.
        # Use the indexed node-scoped query instead of scanning every evidence
        # row in the textbook, while retaining the same projection semantics.
        evidence_rows = list_evidence_for_user_textbook_nodes(
            user_id,
            textbook_id,
            sorted(selected),
        )
    for row in evidence_rows:
        node_id = str(row.get("node_id") or "")
        if node_id and (selected is None or node_id in selected):
            by_node[node_id].append(row)

    nodes: dict[str, dict[str, Any]] = {}
    for node_id, rows in by_node.items():
        latest_chat_id = next((row.get("chat_id") for row in reversed(rows) if row.get("chat_id")), None)
        nodes[node_id] = {
            "status": project_status(rows),
            "closed_evidence_count": sum(row.get("outcome") in CLOSED_OUTCOMES for row in rows),
            "last_activity_at": rows[-1].get("created_at") if rows else None,
            "source_chat_id": latest_chat_id,
        }
    return {
        "textbook_id": textbook_id,
        "catalog_version": catalog_version(textbook_id),
        "revision": get_learning_progress_revision(user_id, textbook_id),
        "nodes": nodes,
    }
