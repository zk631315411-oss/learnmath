"""Read-time real-time computation for the Phase 3 learner model.

Estimates are recomputed from the immutable evidence_turns ledger on every
read; learner_node_estimates / learner_model_runs keep their schemas for
rollback but nothing writes them any more.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Iterable

from app.db.evidence_db import (
    get_learning_progress_revision,
    list_evidence_for_user,
    list_evidence_for_user_textbook_nodes,
)
from app.services.learning.catalog import catalog_version
from app.services.learning.learner_model_types import (
    DEFAULT_PARAMETERS,
    LearnerEstimate,
    ModelParameters,
    validate_model_parameters,
)
from app.services.learning.student_model import replay_node_evidence


UTC = timezone.utc


def estimate_public_dict(
    node_id: str,
    estimate: LearnerEstimate,
    *,
    prerequisite_risk: float | None = None,
) -> dict[str, Any]:
    """Shape one replay result into the public estimate payload."""

    value = estimate.as_dict()
    value["learner_state"] = estimate.state
    value["node_id"] = node_id
    value["prerequisite_risk"] = prerequisite_risk
    value["computed_at"] = estimate.last_observed_at
    value["stale"] = 0
    return value


def compute_node_estimate(
    user_id: str,
    textbook_id: str,
    node_id: str,
    *,
    rows: list[dict[str, Any]] | None = None,
    parameters: ModelParameters = DEFAULT_PARAMETERS,
) -> dict[str, Any]:
    """Read-time estimate for one node, replayed straight from evidence."""

    if rows is None:
        rows = [
            row
            for row in list_evidence_for_user_textbook_nodes(user_id, textbook_id, [node_id])
            if str(row.get("node_id") or "").strip() == node_id
        ]
    estimate = replay_node_evidence(rows, as_of=datetime.now(UTC), parameters=parameters)
    return estimate_public_dict(node_id, estimate)


def list_node_estimates(
    user_id: str,
    textbook_id: str,
    *,
    parameters: ModelParameters = DEFAULT_PARAMETERS,
) -> list[dict[str, Any]]:
    """Read-time estimates for every node with evidence in this textbook."""

    rows = list_evidence_for_user(user_id, textbook_id=textbook_id)
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        node_id = str(row.get("node_id") or "").strip()
        if node_id:
            grouped[node_id].append(row)
    now = datetime.now(UTC)
    return [
        estimate_public_dict(node_id, replay_node_evidence(grouped[node_id], as_of=now, parameters=parameters))
        for node_id in sorted(grouped)
    ]


def replay_user_textbook(
    user_id: str,
    textbook_id: str,
    *,
    node_ids: Iterable[str] | None = None,
    as_of: datetime | str | None = None,
    parameters: ModelParameters = DEFAULT_PARAMETERS,
    prerequisite_risks: dict[str, float | None] | None = None,
) -> dict[str, Any]:
    """Replay selected nodes and return their estimates without persisting.

    Kept as a compute-only compatibility surface for existing callers/tests;
    nothing is written to learner_node_estimates or learner_model_runs.
    """

    clean_user = str(user_id or "").strip()
    clean_book = str(textbook_id or "").strip()
    if not clean_user or not clean_book:
        raise ValueError("user_id and textbook_id are required")
    validate_model_parameters(parameters)
    if prerequisite_risks:
        for node_id, risk in prerequisite_risks.items():
            if risk is None:
                continue
            numeric_risk = float(risk)
            if not math.isfinite(numeric_risk) or not 0.0 <= numeric_risk <= 1.0:
                raise ValueError(f"prerequisite_risk out of range for node {node_id!r}")
    version = catalog_version(clean_book)
    revision = get_learning_progress_revision(clean_user, clean_book)
    requested_node_values = None if node_ids is None else [str(value).strip() for value in node_ids if str(value).strip()]
    if requested_node_values is None:
        all_rows = list_evidence_for_user(clean_user, textbook_id=clean_book)
    else:
        all_rows = list_evidence_for_user_textbook_nodes(
            clean_user,
            clean_book,
            requested_node_values,
        )
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in all_rows:
        node_id = str(row.get("node_id") or "").strip()
        if node_id:
            grouped[node_id].append(row)
    requested_nodes = grouped.keys() if requested_node_values is None else requested_node_values
    selected = {str(value).strip() for value in requested_nodes if str(value).strip()}
    computed = [
        (node_id, replay_node_evidence(grouped.get(node_id, []), as_of=as_of, parameters=parameters))
        for node_id in sorted(selected)
    ]
    return {
        "run_id": None,
        "status": "succeeded",
        "input_revision": revision,
        "catalog_version": version,
        "node_ids": sorted(selected),
        "estimates": [
            estimate_public_dict(
                node_id,
                estimate,
                prerequisite_risk=(prerequisite_risks or {}).get(node_id),
            )
            for node_id, estimate in computed
        ],
    }
