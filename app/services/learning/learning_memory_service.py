"""Bounded, read-only learning-memory index and detail services."""

from __future__ import annotations

import json
import logging
from collections import Counter, defaultdict
from typing import Any, Iterable

from app.config import config
from app.db.evidence_db import (
    list_evidence_by_ids,
    list_evidence_for_user_textbook_nodes,
)
from app.db.learner_model_db import estimate_public_dict
from app.services.learning.catalog import catalog_node_ids
from app.services.learning.learner_model_service import (
    MAX_PREREQUISITES,
    MAX_TARGET_NODES,
    _next_action,
    _prerequisite_context,
)
from app.services.learning.learning_memory_scope import get_memory_scope
from app.services.learning.model_adapter import adapt_evidence
from app.services.learning.progress import project_user_progress
from app.services.learning.student_model import (
    _timestamp_sort_key,
    canonical_evidence_rows,
    replay_node_evidence,
)
from app.db.chat_history_db import get_chat_history


logger = logging.getLogger("learnmath.learning_memory")
MAX_RECENT_OBSERVATIONS = 5
MAX_DETAIL_REFS = 3
MAX_EXCERPT_CODEPOINTS = 200


def retrieve_learning_memory_index(
    user_id: str,
    textbook_id: str,
    node_ids: Iterable[str],
    *,
    allowed_node_ids: set[str] | None = None,
) -> dict[str, Any]:
    """Return bounded memory plus optionally fresh mastery views.

    KG authorization remains a tool-construction concern.  This service still
    validates the textbook catalog so direct callers cannot manufacture nodes.
    """

    if not config.LEARNER_MODEL_ENABLED:
        return {"status": "disabled", "available": False, "nodes": []}
    user_id = str(user_id or "").strip()
    textbook_id = str(textbook_id or "").strip()
    scope = get_memory_scope()
    if not scope or scope.closed or scope.user_id != user_id or scope.textbook_id != textbook_id:
        return {"status": "invalid_scope", "reason": "memory_scope_missing", "nodes": []}

    clean_ids: list[str] = []
    catalog_ids = catalog_node_ids(textbook_id)
    prefix = f"{textbook_id}:"
    for value in node_ids:
        node_id = str(value or "").strip()
        if not node_id:
            continue
        if not node_id.startswith(prefix) or node_id not in catalog_ids:
            return {
                "status": "invalid_scope",
                "reason": "node_not_in_textbook_catalog",
                "nodes": [],
            }
        if allowed_node_ids is not None and node_id not in allowed_node_ids:
            return {
                "status": "invalid_scope",
                "reason": "nodes_must_be_resolved_by_kg_in_this_turn",
                "nodes": [],
            }
        if node_id not in clean_ids:
            clean_ids.append(node_id)
    clean_ids = clean_ids[:MAX_TARGET_NODES]
    if not clean_ids:
        return {"status": "invalid_scope", "nodes": []}

    try:
        rows = list_evidence_for_user_textbook_nodes(user_id, textbook_id, clean_ids)
    except Exception:
        logger.exception("learning memory evidence read failed user=%s book=%s", user_id, textbook_id)
        return {"status": "unavailable", "reason": "evidence_read_failed", "nodes": []}

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        node_id = str(row.get("node_id") or "").strip()
        if node_id in clean_ids:
            grouped[node_id].append(row)
    canonical_by_node = {
        node_id: canonical_evidence_rows(grouped.get(node_id, []))
        for node_id in clean_ids
    }

    # Read-time replay: new evidence is reflected immediately; only a
    # computation failure degrades the view to partial.
    estimates: dict[str, dict[str, Any] | None] = {}
    replay_failed = False
    for node_id in clean_ids:
        try:
            estimate = replay_node_evidence(canonical_by_node[node_id])
            estimates[node_id] = estimate_public_dict(node_id, estimate)
        except Exception:
            replay_failed = True
            estimates[node_id] = None
            logger.exception("learning memory read-time replay failed user=%s node=%s", user_id, node_id)

    try:
        progress = project_user_progress(user_id, textbook_id)
    except Exception:
        logger.exception("learning memory progress read failed user=%s book=%s", user_id, textbook_id)
        return {"status": "unavailable", "reason": "progress_read_failed", "nodes": []}

    result_nodes: list[dict[str, Any]] = []
    partial = replay_failed
    recent_candidates_by_node: dict[str, list[dict[str, Any]]] = {}
    for node_id in clean_ids:
        canonical_rows = canonical_by_node[node_id]
        snapshot = estimates.get(node_id)
        try:
            memory_summary = _memory_summary(canonical_rows)
            recent_candidates_by_node[node_id] = _recent_observations_sorted(canonical_rows)
        except (TypeError, ValueError):
            logger.exception("learning memory evidence adaptation failed user=%s node=%s", user_id, node_id)
            partial = True
            memory_summary = {
                "observation_count": len(canonical_rows),
                "closed_observation_count": 0,
                "outcome_counts": {},
                "last_observed_at": None,
                "last_closed_at": None,
            }
            recent_candidates_by_node[node_id] = []
        map_status = (progress.get("nodes", {}).get(node_id, {}) or {}).get("status", "unexplored")

        mastery_view: dict[str, Any]
        teaching_hint: dict[str, Any] | None = None
        # A node with no evidence still needs a bounded KG lookup so the Agent
        # can decide whether to check a prerequisite.  Replay failures with
        # existing evidence stay fail-closed and do not trigger a second KG
        # query.  Keeping this decision in one branch prevents duplicate
        # lookups (and makes the one-read budget observable in tests).
        prerequisites: list[dict[str, Any]] = []
        risk: float | None = None
        kg_available = False
        if snapshot is not None or not canonical_rows:
            prerequisites, risk, kg_available = _prerequisite_context(
                user_id, textbook_id, node_id,
            )

        if snapshot is None:
            # Read-time replay failed for this node (or no evidence exists);
            # preserve the memory index while omitting teaching_hint.
            partial = True
            mastery_view = {
                "learner_state": None,
                "map_status": map_status,
                "stale": True,
                "updated_at": None,
            }
        else:
            mastery_view = {
                "learner_state": snapshot.get("learner_state") or "unknown",
                "map_status": map_status,
                "stale": False,
                "updated_at": snapshot.get("computed_at"),
            }
            teaching_hint = {
                "recommended_action": _next_action(
                    snapshot.get("learner_state"),
                    risk if kg_available else None,
                    snapshot.get("estimate"),
                ),
                "kg_available": kg_available,
            }
            if kg_available:
                teaching_hint["prerequisite_risk"] = risk
        node_result = {
            "node_id": node_id,
            "memory_summary": memory_summary,
            "recent_observations": [],
            "mastery_view": mastery_view,
            "prerequisites": _public_prerequisites(prerequisites),
        }
        if teaching_hint is not None:
            node_result["teaching_hint"] = teaching_hint
        result_nodes.append(node_result)

    # Global top-N recent observations across all target nodes, then grouped
    # back into per-node lists while preserving descending order within each.
    selected_recent_by_node = _select_global_recent_observations(
        recent_candidates_by_node, scope, limit=MAX_RECENT_OBSERVATIONS,
    )
    for node_result in result_nodes:
        node_result["recent_observations"] = selected_recent_by_node.get(
            node_result["node_id"], []
        )

    return {
        "status": "partial" if partial else "ok",
        "available": True,
        "memory_view_version": "learning-memory-v2",
        "textbook_id": textbook_id,
        "nodes": result_nodes,
        "limits": {
            "target_nodes": MAX_TARGET_NODES,
            "prerequisite_hops": 2,
            "prerequisites_per_hop": MAX_PREREQUISITES,
            "prerequisites_total_per_node": MAX_PREREQUISITES * 2,
            "recent_observations_total": MAX_RECENT_OBSERVATIONS,
        },
    }


def retrieve_learning_memory_detail(
    user_id: str,
    textbook_id: str,
    memory_refs: list[dict[str, Any]],
) -> dict[str, Any]:
    """Resolve only refs registered by this request's memory index."""

    if not config.LEARNER_MODEL_ENABLED:
        return {"status": "disabled", "available": False, "observations": []}
    scope = get_memory_scope()
    if not scope or scope.closed or scope.user_id != user_id or scope.textbook_id != textbook_id:
        return {"status": "invalid_scope", "reason": "memory_scope_missing", "observations": []}
    if not isinstance(memory_refs, list) or not 1 <= len(memory_refs) <= MAX_DETAIL_REFS:
        return {"status": "invalid_scope", "reason": "invalid_ref_count", "observations": []}
    if any(not isinstance(ref, dict) or not scope.accepts(ref) for ref in memory_refs):
        return {"status": "invalid_scope", "reason": "ref_not_registered", "observations": []}

    normalized_refs = [
        {
            "evidence_id": str(ref["evidence_id"]).strip(),
            "node_id": str(ref["node_id"]).strip(),
            "textbook_id": str(ref["textbook_id"]).strip(),
        }
        for ref in memory_refs
    ]
    rows = list_evidence_by_ids(
        user_id,
        textbook_id,
        [ref["evidence_id"] for ref in normalized_refs],
    )
    by_id = {str(row.get("id")): row for row in rows}
    if any(
        ref["evidence_id"] not in by_id
        or str(by_id[ref["evidence_id"]].get("node_id") or "") != ref["node_id"]
        or str(by_id[ref["evidence_id"]].get("textbook_id") or "") != textbook_id
        for ref in normalized_refs
    ):
        return {"status": "invalid_scope", "reason": "evidence_scope_mismatch", "observations": []}

    observations = []
    for ref in normalized_refs:
        row = by_id[ref["evidence_id"]]
        adapted = adapt_evidence(row)
        observation = {
            "memory_ref": ref,
            "outcome": adapted.effective_outcome,
            "raw_outcome": adapted.raw_outcome,
            "scaffolding_level": row.get("scaffolding_level"),
            "observed_at": row.get("created_at"),
        }
        question, answer, truncated = _visible_chat_excerpt(
            user_id,
            textbook_id,
            row,
        )
        if question is not None:
            observation["student_question"] = question
        if answer is not None:
            observation["teacher_answer_excerpt"] = answer
        observation["truncated"] = truncated
        observations.append(observation)
    return {
        "status": "ok",
        "available": True,
        "observations": observations,
    }


def _memory_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    counts: Counter[str] = Counter()
    effective_counts: Counter[str] = Counter()
    closed = 0
    last_observed = None
    last_closed = None
    for row in rows:
        adapted = adapt_evidence(row)
        counts[adapted.raw_outcome] += 1
        effective_counts[adapted.effective_outcome] += 1
        created_at = row.get("created_at")
        if created_at and (last_observed is None or str(created_at) > str(last_observed)):
            last_observed = created_at
        if adapted.closed_observation:
            closed += 1
            if created_at and (last_closed is None or str(created_at) > str(last_closed)):
                last_closed = created_at
    return {
        "observation_count": len(rows),
        "closed_observation_count": closed,
        "outcome_counts": {
            name: counts.get(name, 0)
            for name in ("independent", "assisted", "direct_taught", "unresolved")
        },
        "effective_outcome_counts": {
            name: effective_counts.get(name, 0)
            for name in ("independent", "assisted", "direct_taught", "unresolved")
        },
        "last_observed_at": last_observed,
        "last_closed_at": last_closed,
    }


def _recent_observations_sorted(
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return rows sorted by created_at DESC, then id DESC.

    Does not truncate or register scope refs; callers handle global budgeting.
    """
    return sorted(
        rows,
        key=lambda row: (
            _timestamp_sort_key(row.get("created_at")),
            str(row.get("id") or ""),
        ),
        reverse=True,
    )


def _select_global_recent_observations(
    candidates_by_node: dict[str, list[dict[str, Any]]],
    scope,
    *,
    limit: int = MAX_RECENT_OBSERVATIONS,
) -> dict[str, list[dict[str, Any]]]:
    """Take the globally newest candidates up to `limit`, register their refs,
    and group them back by node preserving per-node DESC order.
    """
    all_candidates: list[tuple[str, dict[str, Any]]] = []
    for node_id, rows in candidates_by_node.items():
        for row in rows:
            all_candidates.append((node_id, row))

    all_candidates.sort(
        key=lambda item: (
            _timestamp_sort_key(item[1].get("created_at")),
            str(item[1].get("id") or ""),
        ),
        reverse=True,
    )

    selected = all_candidates[:max(0, limit)]
    result_by_node: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for node_id, row in selected:
        evidence_id = str(row.get("id") or "").strip()
        ref = {
            "evidence_id": evidence_id,
            "node_id": str(row.get("node_id") or ""),
            "textbook_id": str(row.get("textbook_id") or ""),
        }
        scope.register(ref)
        adapted = adapt_evidence(row)
        result_by_node[node_id].append({
            "memory_ref": ref,
            "outcome": adapted.effective_outcome,
            "raw_outcome": adapted.raw_outcome,
            "scaffolding_level": row.get("scaffolding_level"),
            "observed_at": row.get("created_at"),
        })
    return result_by_node


def _recent_observations(
    rows: list[dict[str, Any]],
    scope,
    *,
    limit: int = MAX_RECENT_OBSERVATIONS,
) -> list[dict[str, Any]]:
    """Deprecated single-node helper kept for compatibility."""
    sorted_rows = _recent_observations_sorted(rows)
    selected = _select_global_recent_observations(
        {"": sorted_rows}, scope, limit=limit,
    )
    return selected.get("", [])


def _public_prerequisites(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "node_id": item.get("node_id"),
            "name": item.get("name"),
            "learner_state": item.get("learner_state") or "unknown",
            "map_status": item.get("map_status") or "unexplored",
            "prerequisite_risk": item.get("risk"),
            "stale": bool(item.get("stale")),
            # 1 = 直接前置，2 = 前置的前置（沿 PREREQUISITE_OF 递归一跳）。
            "hop": item.get("hop", 1),
        }
        for item in items
        if item.get("node_id")
    ]


def _visible_chat_excerpt(
    user_id: str,
    textbook_id: str,
    evidence: dict[str, Any],
) -> tuple[str | None, str | None, bool]:
    chat_id = str(evidence.get("chat_id") or "").strip()
    if not chat_id:
        return None, None, False
    try:
        records = get_chat_history(user_id, chat_id=chat_id, textbook_id=textbook_id)
    except Exception:
        logger.exception("learning memory chat detail read failed user=%s chat=%s", user_id, chat_id)
        return None, None, False
    if not records:
        return None, None, False
    record = records[0]
    record_textbook = str(record.get("textbook_id") or "").strip()
    if record_textbook not in {"", textbook_id}:
        return None, None, False
    question = record.get("question")
    answer = record.get("answer")
    qa_turn_id = str(evidence.get("qa_turn_id") or "").strip()
    if qa_turn_id:
        try:
            follow_ups = json.loads(record.get("follow_ups") or "[]")
        except (TypeError, ValueError):
            follow_ups = []
        for follow_up in follow_ups if isinstance(follow_ups, list) else []:
            if not isinstance(follow_up, dict):
                continue
            follow_up_id = str(follow_up.get("id") or follow_up.get("turn_id") or "").strip()
            if follow_up_id == qa_turn_id:
                question = follow_up.get("question")
                answer = follow_up.get("answer")
                break
    question, q_truncated = _excerpt(question)
    answer, a_truncated = _excerpt(answer)
    return question, answer, q_truncated or a_truncated


def _excerpt(value: Any) -> tuple[str | None, bool]:
    if value is None:
        return None, False
    text = str(value)
    return text[:MAX_EXCERPT_CODEPOINTS], len(text) > MAX_EXCERPT_CODEPOINTS
