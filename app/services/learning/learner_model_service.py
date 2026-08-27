"""Public and Agent-facing read services for the learner model."""

from __future__ import annotations

import logging
from typing import Any, Iterable

from app.config import config
from app.db import kg_v44
from app.db.evidence_db import get_learning_progress_revision
from app.db.learner_model_db import compute_node_estimate, list_node_estimates
from app.services.learning.catalog import catalog_node_ids, catalog_version
from app.services.learning.learner_model_types import (
    DEFAULT_PARAMETERS,
)
from app.services.learning.progress import project_user_progress
from app.services.learning.student_model import _timestamp_sort_key


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
        try:
            revision = get_learning_progress_revision(user_id, textbook_id)
        except Exception:
            # The model endpoint is intentionally best-effort.  An empty
            # evidence set must not turn a revision-store outage into a 500.
            logger.exception(
                "learner model revision read failed user=%s book=%s",
                user_id,
                textbook_id,
            )
            return neutral_response(
                textbook_id,
                status="unavailable",
                catalog_version_value=version,
            )
        return {
            "status": "ok",
            "available": True,
            "textbook_id": textbook_id,
            "catalog_version": version,
            "revision": revision,
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
        # ``updated_at`` is the latest learner observation for UI purposes;
        # ``computed_at`` remains available in development debug for the
        # read-time evaluation timestamp.
        "updated_at": _latest_observation_timestamp(estimates),
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
    prerequisites, risk, kg_available = _prerequisite_context(
        user_id,
        textbook_id,
        node_id,
        progress_snapshot=progress,
    )
    node["next_action"] = _next_action(node.get("learner_state"), risk, snapshot.get("estimate"))
    node["prerequisite_hint"] = _prerequisite_hint(node.get("learner_state"), risk, kg_available)
    node["prerequisites"] = [
        {
            "node_id": item["node_id"],
            "learner_state": item["learner_state"],
            "map_status": item["map_status"],
            "hop": item.get("hop", 1),
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
        # Do not make a passive GET look like new learning activity.
        "updated_at": estimate.get("last_observed_at"),
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


def _latest_observation_timestamp(estimates: Iterable[dict[str, Any]]) -> str | None:
    """Return the newest observation without comparing offset strings lexically."""

    candidates = [
        item for item in estimates
        if item.get("last_observed_at")
    ]
    if not candidates:
        return None
    latest = max(
        candidates,
        key=lambda item: (
            _timestamp_sort_key(item.get("last_observed_at")),
            str(item.get("node_id") or ""),
        ),
    )
    return latest.get("last_observed_at")


def _prerequisite_context(
    user_id: str,
    textbook_id: str,
    node_id: str,
    *,
    progress_snapshot: dict[str, Any] | None = None,
    estimate_cache: dict[str, dict[str, Any] | None] | None = None,
) -> tuple[list[dict[str, Any]], float | None, bool]:
    """沿 PREREQUISITE_OF 入边递归到深度 2，返回带去重与 hop 标注的前置上下文。

    每一跳（层）最多收录 MAX_PREREQUISITES 个节点；第二跳从第一跳收录的
    节点继续展开，跨层去重（目标节点本身也排除）。第一跳的 KG 查询失败
    按原契约返回 ([], None, False)；第二跳某个节点展开失败只跳过该分支，
    不拖垮已收集的结果。返回排序上「该学生有证据或有地图状态的节点」优先
    于纯 KG 推断节点，其余按 hop 升序、风险降序，保证教学上最相关的薄弱
    前置排在前面。
    """
    if progress_snapshot is None:
        try:
            progress = project_user_progress(user_id, textbook_id)
        except Exception:
            return [], None, False
    else:
        progress = progress_snapshot

    # KG data is authoritative for relationships, but the static catalog is
    # the tenant boundary for nodes exposed to the learner model.  Unknown
    # textbook IDs are left compatible for internal callers/tests; public
    # routes validate the textbook before reaching this function.
    catalog_ids = catalog_node_ids(textbook_id)
    contexts: list[dict[str, Any]] = []
    seen: set[str] = {node_id}
    frontier = [node_id]
    for hop in (1, 2):
        layer: list[dict[str, Any]] = []
        next_frontier: list[str] = []
        for current_id in frontier:
            if len(layer) >= MAX_PREREQUISITES:
                break
            try:
                relationships, _ = kg_v44.get_kg_relationships(
                    current_id,
                    focus=["prerequisites"],
                    textbook_id=textbook_id,
                    limit_per_group=MAX_PREREQUISITES,
                )
            except Exception:
                if hop == 1:
                    return [], None, False
                continue
            items = relationships.get("explicit_prerequisites") or []
            for item in items:
                if len(layer) >= MAX_PREREQUISITES:
                    break
                if not isinstance(item, dict):
                    continue
                if item.get("relationship_type") != "PREREQUISITE_OF" or item.get("direction") != "incoming":
                    continue
                prereq = item.get("node") if isinstance(item, dict) else None
                if not isinstance(prereq, dict) or not prereq.get("node_id"):
                    continue
                prereq_id = str(prereq["node_id"])
                if (
                    not prereq_id.startswith(f"{textbook_id}:")
                    or (catalog_ids and prereq_id not in catalog_ids)
                    or prereq_id in seen
                ):
                    continue
                seen.add(prereq_id)
                next_frontier.append(prereq_id)
                snapshot = _cached_prerequisite_estimate(
                    user_id,
                    textbook_id,
                    prereq_id,
                    estimate_cache,
                )
                if snapshot is None:
                    estimate = 0.5
                    state = "unknown"
                    map_status = "unexplored"
                    risk = 1.0
                    evidence_count = 0
                if snapshot is not None:
                    estimate = float(snapshot.get("estimate") or 0.5)
                    state = str(snapshot.get("learner_state") or "unknown")
                    map_status = (progress.get("nodes", {}).get(prereq_id, {}) or {}).get("status", "unexplored")
                    risk = 1.0 - estimate
                    evidence_count = int(snapshot.get("evidence_count") or 0)
                risk = _clamp_risk(risk)
                layer.append({
                    "node_id": prereq_id,
                    "name": prereq.get("name"),
                    "estimate": estimate,
                    "learner_state": state,
                    "map_status": map_status,
                    "risk": risk,
                    "stale": snapshot is None,
                    "hop": hop,
                    "evidence_count": evidence_count,
                })
        contexts.extend(layer)
        frontier = next_frontier
        if not frontier:
            break

    contexts.sort(key=_prerequisite_sort_key)
    return contexts, aggregate_prerequisite_risk(item["risk"] for item in contexts), True


def _cached_prerequisite_estimate(
    user_id: str,
    textbook_id: str,
    node_id: str,
    estimate_cache: dict[str, dict[str, Any] | None] | None,
) -> dict[str, Any] | None:
    """Load one prerequisite estimate, reusing it across target nodes.

    A memory-index request can contain three targets whose prerequisite
    neighborhoods overlap.  Caching both successful and failed lookups keeps
    that bounded request from repeating identical SQLite reads while leaving
    the single-node compatibility path unchanged when no cache is supplied.
    """

    if estimate_cache is not None and node_id in estimate_cache:
        return estimate_cache[node_id]
    try:
        snapshot = compute_node_estimate(user_id, textbook_id, node_id)
    except Exception:
        logger.exception(
            "learner model prerequisite replay failed user=%s node=%s",
            user_id,
            node_id,
        )
        snapshot = None
    if estimate_cache is not None:
        estimate_cache[node_id] = snapshot
    return snapshot


def _prerequisite_sort_key(item: dict[str, Any]) -> tuple[int, int, float, str]:
    """有学生证据或地图状态的节点优先；其余按跳数升序、风险降序。"""
    has_signal = bool(item.get("evidence_count")) or item.get("map_status") not in {None, "unexplored"}
    return (
        0 if has_signal else 1,
        int(item.get("hop") or 1),
        -float(item.get("risk") or 0.0),
        str(item.get("node_id") or ""),
    )


def aggregate_prerequisite_risk(risks: Iterable[float | None]) -> float:
    """Version-2 KG risk contract: max risk across depth-1 and depth-2 prerequisites.

    Each risk is ``1 - estimate`` for a fresh prerequisite.  Missing or stale
    prerequisite snapshots are represented as ``1.0`` by the caller because
    the system cannot verify that prerequisite yet.  ``_prerequisite_context``
    now walks PREREQUISITE_OF recursively to depth 2, so this aggregation
    covers both hops (each hop capped at MAX_PREREQUISITES); no other KG
    relation participates, and an empty set is zero risk.
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
