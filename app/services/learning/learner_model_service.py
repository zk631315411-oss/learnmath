"""Public and Agent-facing read services for the learner model."""

from __future__ import annotations

import logging
from typing import Any, Iterable

from app.config import config
from app.db import kg_v44
from app.db.learner_model_db import compute_node_estimate, list_node_estimates
from app.services.learning.catalog import catalog_version
from app.services.learning.learner_model_types import (
    DEFAULT_PARAMETERS,
)
from app.services.learning.progress import project_user_progress


logger = logging.getLogger("learnmath.learner_model")
MAX_TARGET_NODES = 3
MAX_PREREQUISITES = 5
_RISK_MIN = 0.0
_RISK_MAX = 1.0

# emerging 状态下视为"估计已较扎实"的 estimate 下限。只影响教学动作选择
# （review_with_variation vs ask_minimal_probe），不参与 replay，不进 ModelParameters。
_EMERGING_SOLID_ESTIMATE = 0.70


def model_debug_enabled() -> bool:
    return bool(config.LEARNER_MODEL_DEBUG) and str(config.APP_ENV).lower() in {
        "development", "dev", "test", "local",
    }


def neutral_response(
    textbook_id: str,
    *,
    status: str,
    catalog_version_value: str | None = None,
    revision: int | None = None,
) -> dict[str, Any]:
    return {
        "status": status,
        "available": False,
        "textbook_id": textbook_id,
        "catalog_version": catalog_version_value,
        "revision": revision,
        "nodes": [],
        "updated_at": None,
    }


def get_public_model(
    user_id: str,
    textbook_id: str,
    *,
    debug: bool = False,
) -> dict[str, Any]:
    """Return a student-safe overview; internal parameters require dev debug."""

    version = catalog_version(textbook_id)
    if not config.LEARNER_MODEL_ENABLED:
        return neutral_response(textbook_id, status="disabled", catalog_version_value=version)

    try:
        estimates = list_node_estimates(user_id, textbook_id)
    except Exception:
        logger.exception("learner model read-time replay failed user=%s book=%s", user_id, textbook_id)
        return neutral_response(textbook_id, status="unavailable", catalog_version_value=version)
    if not estimates:
        return {
            "status": "ok",
            "available": True,
            "textbook_id": textbook_id,
            "catalog_version": version,
            "revision": 0,
            "nodes": [],
            "updated_at": None,
        }

    try:
        progress = project_user_progress(user_id, textbook_id)
    except Exception:
        logger.exception("learner model progress read failed user=%s book=%s", user_id, textbook_id)
        return neutral_response(textbook_id, status="unavailable", catalog_version_value=version)
    nodes = [
        _public_snapshot(
            estimate,
            map_status=(progress.get("nodes", {}).get(estimate["node_id"], {}) or {}).get("status", "unexplored"),
            debug=debug and model_debug_enabled(),
        )
        for estimate in estimates
    ]
    return {
        "status": "ok",
        "available": True,
        "textbook_id": textbook_id,
        "catalog_version": version,
        "revision": progress.get("revision"),
        "nodes": nodes,
        "updated_at": max((item.get("computed_at") or "" for item in estimates), default=None),
    }


def get_public_node(
    user_id: str,
    textbook_id: str,
    node_id: str,
    *,
    debug: bool = False,
) -> dict[str, Any]:
    version = catalog_version(textbook_id)
    if not config.LEARNER_MODEL_ENABLED:
        return neutral_response(textbook_id, status="disabled", catalog_version_value=version) | {
            "node_id": node_id,
        }

    try:
        snapshot = compute_node_estimate(user_id, textbook_id, node_id)
    except Exception:
        logger.exception("learner model node read-time replay failed user=%s node=%s", user_id, node_id)
        return neutral_response(textbook_id, status="unavailable", catalog_version_value=version) | {
            "node_id": node_id,
        }

    try:
        progress = project_user_progress(user_id, textbook_id)
    except Exception:
        logger.exception("learner model node progress read failed user=%s node=%s", user_id, node_id)
        return neutral_response(textbook_id, status="unavailable", catalog_version_value=version) | {
            "node_id": node_id,
        }
    map_status = (progress.get("nodes", {}).get(node_id, {}) or {}).get("status", "unexplored")
    node = _public_snapshot(snapshot, map_status=map_status, debug=debug and model_debug_enabled())
    prerequisites, risk, kg_available = _prerequisite_context(user_id, textbook_id, node_id)
    node["next_action"] = _next_action(node.get("learner_state"), risk, snapshot.get("estimate"))
    node["prerequisite_hint"] = _prerequisite_hint(node.get("learner_state"), risk, kg_available)
    node["prerequisites"] = [
        {
            "node_id": item["node_id"],
            "learner_state": item["learner_state"],
            "map_status": item["map_status"],
        }
        for item in prerequisites
    ]
    # The risk is an action signal only.  It is deliberately omitted from the
    # ordinary student response; development debug may inspect it.
    if debug and model_debug_enabled():
        node["prerequisite_risk"] = risk
        node["kg_available"] = kg_available
    return {
        "status": "ok",
        "available": True,
        "textbook_id": textbook_id,
        "catalog_version": version,
        "revision": progress.get("revision"),
        "node": node,
    }


def _public_snapshot(estimate: dict[str, Any], *, map_status: str, debug: bool) -> dict[str, Any]:
    state = str(estimate.get("learner_state") or "unknown")
    value = {
        "node_id": estimate.get("node_id"),
        "map_status": map_status,
        "learner_state": state,
        "next_action": _next_action(state, None, estimate.get("estimate")),
        "updated_at": estimate.get("computed_at"),
        "available": True,
    }
    if debug:
        for key in (
            "alpha", "beta", "raw_mean", "variance", "recency", "estimate", "uncertainty",
            "decay_risk", "prerequisite_risk",
            "evidence_count", "closed_evidence_count", "independent_count", "assisted_count",
            "raw_independent_count", "raw_assisted_count", "direct_taught_count", "unresolved_count",
            "last_observed_at", "last_closed_at",
        ):
            value[key] = estimate.get(key)
    return value


def _prerequisite_context(
    user_id: str,
    textbook_id: str,
    node_id: str,
) -> tuple[list[dict[str, Any]], float | None, bool]:
    try:
        relationships, _ = kg_v44.get_kg_relationships(
            node_id,
            focus=["prerequisites"],
            textbook_id=textbook_id,
            limit_per_group=MAX_PREREQUISITES,
        )
    except Exception:
        return [], None, False
    items = relationships.get("explicit_prerequisites") or []
    contexts = []
    try:
        progress = project_user_progress(user_id, textbook_id)
    except Exception:
        return [], None, False
    risks = []
    for item in items[:MAX_PREREQUISITES]:
        if not isinstance(item, dict):
            continue
        if item.get("relationship_type") != "PREREQUISITE_OF" or item.get("direction") != "incoming":
            continue
        prereq = item.get("node") if isinstance(item, dict) else None
        if not isinstance(prereq, dict) or not prereq.get("node_id"):
            continue
        prereq_id = str(prereq["node_id"])
        if not prereq_id.startswith(f"{textbook_id}:"):
            continue
        try:
            snapshot = compute_node_estimate(user_id, textbook_id, prereq_id)
        except Exception:
            estimate = 0.5
            state = "unknown"
            map_status = "unexplored"
            risk = 1.0
            snapshot = None
        if snapshot is not None:
            estimate = float(snapshot.get("estimate") or 0.5)
            state = str(snapshot.get("learner_state") or "unknown")
            map_status = (progress.get("nodes", {}).get(prereq_id, {}) or {}).get("status", "unexplored")
            risk = 1.0 - estimate
        risk = _clamp_risk(risk)
        risks.append(risk)
        contexts.append({
            "node_id": prereq_id,
            "name": prereq.get("name"),
            "estimate": estimate,
            "learner_state": state,
            "map_status": map_status,
            "risk": risk,
            "stale": snapshot is None,
        })
    return contexts, aggregate_prerequisite_risk(risks), True


def aggregate_prerequisite_risk(risks: Iterable[float | None]) -> float:
    """Version-1 KG risk contract: max risk across direct prerequisites.

    Each risk is ``1 - estimate`` for a fresh prerequisite.  Missing or stale
    prerequisite snapshots are represented as ``1.0`` by the caller because
    the system cannot verify that prerequisite yet.  No recursive or ordinary
    KG relation participates in this aggregation; an empty set is zero risk.
    """

    values = [_clamp_risk(value) for value in risks if value is not None]
    return max(values, default=0.0)


def _clamp_risk(value: float | None) -> float:
    if value is None:
        return 1.0
    numeric = float(value)
    if numeric != numeric or numeric in {float("inf"), float("-inf")}:
        raise ValueError("prerequisite risk must be finite")
    return max(_RISK_MIN, min(_RISK_MAX, numeric))


def _next_action(
    state: str | None,
    prerequisite_risk: float | None,
    estimate: float | None = None,
) -> str:
    if prerequisite_risk is not None and prerequisite_risk >= DEFAULT_PARAMETERS.check_prerequisite_threshold:
        return "check_prerequisite"
    if state == "model_needs_review":
        return "review_with_variation"
    if state == "likely_ready":
        return "review_with_variation"
    # emerging 但估计已较高（证据条数不足未能进 likely_ready）时，用变式确认
    # 衔接新内容，而不是和估得低的学生一样反复做基础探测。这是动作层区分，
    # 不改 replay 阈值。阈值独立于 ModelParameters，不影响 model_version。
    if state == "emerging" and estimate is not None and estimate >= _EMERGING_SOLID_ESTIMATE:
        return "review_with_variation"
    if state in {"unknown", "emerging"}:
        return "ask_minimal_probe"
    return "defer_and_collect_evidence"


def _prerequisite_hint(state: str | None, risk: float | None, kg_available: bool) -> str:
    if not kg_available or risk is None:
        return ""
    if risk >= DEFAULT_PARAMETERS.check_prerequisite_threshold:
        return "建议先检查一个明确前置"
    if state == "likely_ready":
        return "建议做一道变式题确认迁移"
    if state == "model_needs_review":
        return "建议复习后再做一道变式题"
    return "建议先做一个最小探测题"
