"""Versioned mapping from LearnMath evidence outcomes to Beta observations."""

from __future__ import annotations

from typing import Any

from app.services.learning.learner_model_types import (
    AdaptedEvidence,
    DEFAULT_PARAMETERS,
    Outcome,
)


ADAPTER_VERSION = DEFAULT_PARAMETERS.adapter_version
MODEL_VERSION = DEFAULT_PARAMETERS.model_version
VALID_OUTCOMES = {"independent", "assisted", "direct_taught", "unresolved"}


def adapt_evidence(row: dict[str, Any]) -> AdaptedEvidence:
    """Map one fact row without changing or enriching the source row.

    An ``independent`` report with scaffolding is intentionally downgraded to
    an assisted signal.  The raw outcome remains available in the estimate's
    raw counters and in the immutable evidence ledger.
    """

    raw_outcome = str(row.get("outcome") or "").strip()
    if raw_outcome not in VALID_OUTCOMES:
        raise ValueError(f"unsupported evidence outcome: {raw_outcome!r}")

    try:
        scaffolding_level = int(row.get("scaffolding_level") or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError("scaffolding_level must be an integer") from exc
    if scaffolding_level < 0:
        raise ValueError("scaffolding_level must be non-negative")

    outcome: Outcome = raw_outcome  # type narrowing for the literal union
    if raw_outcome == "independent" and scaffolding_level > 0:
        outcome = "assisted"
        reason = "independent_with_scaffolding_downgraded_to_assisted"
    else:
        reason = f"direct_{raw_outcome}_mapping"

    if outcome == "independent":
        return AdaptedEvidence(
            evidence_id=str(row.get("id") or ""),
            node_id=str(row.get("node_id") or ""),
            textbook_id=str(row.get("textbook_id") or ""),
            raw_outcome=raw_outcome,
            effective_outcome=outcome,
            scaffolding_level=scaffolding_level,
            alpha_delta=1.0,
            beta_delta=0.0,
            effective_independent=True,
            effective_assisted=False,
            closed_observation=True,
            adaptation_reason=reason,
        )
    if outcome == "assisted":
        return AdaptedEvidence(
            evidence_id=str(row.get("id") or ""),
            node_id=str(row.get("node_id") or ""),
            textbook_id=str(row.get("textbook_id") or ""),
            raw_outcome=raw_outcome,
            effective_outcome=outcome,
            scaffolding_level=scaffolding_level,
            alpha_delta=0.5,
            beta_delta=0.25,
            effective_independent=False,
            effective_assisted=True,
            closed_observation=True,
            adaptation_reason=reason,
        )
    if outcome == "direct_taught":
        return AdaptedEvidence(
            evidence_id=str(row.get("id") or ""),
            node_id=str(row.get("node_id") or ""),
            textbook_id=str(row.get("textbook_id") or ""),
            raw_outcome=raw_outcome,
            effective_outcome=outcome,
            scaffolding_level=scaffolding_level,
            alpha_delta=0.0,
            beta_delta=0.0,
            effective_independent=False,
            effective_assisted=False,
            closed_observation=True,
            adaptation_reason=reason,
        )
    return AdaptedEvidence(
        evidence_id=str(row.get("id") or ""),
        node_id=str(row.get("node_id") or ""),
        textbook_id=str(row.get("textbook_id") or ""),
        raw_outcome=raw_outcome,
        effective_outcome="unresolved",
        scaffolding_level=scaffolding_level,
        alpha_delta=0.0,
        beta_delta=0.0,
        effective_independent=False,
        effective_assisted=False,
        closed_observation=False,
        adaptation_reason=reason,
    )
