"""Deterministic, replayable Beta learner model for one KG node."""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Iterable

from app.services.learning.learner_model_types import (
    DEFAULT_PARAMETERS,
    LearnerEstimate,
    ModelParameters,
    validate_model_parameters,
)
from app.services.learning.model_adapter import adapt_evidence


_UTC = timezone.utc
_EPSILON = 1e-12


def canonical_evidence_rows(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return one deterministic row for each logical evidence identity.

    New writes are protected by a partial unique index, but replay also has to
    handle imported and legacy rows that can contain duplicate logical turns.
    Every derived representation must use this same canonical set so counts,
    model updates, and evidence references remain explainable together.
    """

    unique_rows: dict[tuple[str, str], dict[str, Any]] = {}
    for row_index, source in enumerate(rows):
        row = dict(source)
        client_turn_id = str(row.get("client_turn_id") or "")
        evidence_id = str(row.get("id") or "")
        if client_turn_id:
            identity_key = f"turn:{client_turn_id}"
        elif evidence_id:
            identity_key = f"id:{evidence_id}"
        else:
            # Rows without either identifier are distinct imported observations.
            identity_key = f"row:{row_index}"
        identity = (identity_key, str(row.get("node_id") or ""))
        previous = unique_rows.get(identity)
        if previous is None or (
            _timestamp_sort_key(row.get("created_at")), evidence_id
        ) < (
            _timestamp_sort_key(previous.get("created_at")),
            str(previous.get("id") or ""),
        ):
            unique_rows[identity] = row
    return sorted(
        unique_rows.values(),
        key=lambda row: (_timestamp_sort_key(row.get("created_at")), str(row.get("id") or "")),
    )


def replay_node_evidence(
    rows: Iterable[dict[str, Any]],
    *,
    as_of: datetime | str | None = None,
    parameters: ModelParameters = DEFAULT_PARAMETERS,
) -> LearnerEstimate:
    """Replay one node's immutable evidence in chronological order.

    Alpha/Beta are never decayed in storage.  Recency affects the computed
    estimate only, which prevents repeated replay from applying decay twice.
    """

    validate_model_parameters(parameters)

    ordered = canonical_evidence_rows(rows)
    alpha = float(parameters.prior_alpha)
    beta = float(parameters.prior_beta)
    _assert_beta_invariant(alpha, beta)

    raw_count = {
        "independent": 0,
        "assisted": 0,
        "direct_taught": 0,
        "unresolved": 0,
    }
    raw_independent_count = 0
    raw_assisted_count = 0
    effective_independent_count = 0
    effective_assisted_count = 0
    closed_count = 0
    last_outcome = None
    last_observed_at: str | None = None
    last_closed_at: str | None = None

    for row in ordered:
        adapted = adapt_evidence(row)
        raw_count[adapted.raw_outcome] += 1
        raw_independent_count += adapted.raw_outcome == "independent"
        raw_assisted_count += adapted.raw_outcome == "assisted"
        alpha += adapted.alpha_delta
        beta += adapted.beta_delta
        # Keep the invariant local to every update.  This prevents a future
        # adapter change (for example, a negative correction) from producing
        # an invalid intermediate posterior that only fails at the end.
        _assert_beta_invariant(alpha, beta)
        if adapted.effective_independent:
            effective_independent_count += 1
        if adapted.effective_assisted:
            effective_assisted_count += 1
        if adapted.closed_observation:
            closed_count += 1
            last_closed_at = _timestamp_text(row.get("created_at"))
        last_outcome = adapted.effective_outcome
        last_observed_at = _timestamp_text(row.get("created_at"))

    _assert_beta_invariant(alpha, beta)
    now = _coerce_datetime(as_of) if as_of is not None else datetime.now(_UTC)
    raw_mean, variance, recency, estimate, uncertainty, decay_risk = _project_beta(
        alpha,
        beta,
        last_closed_at=last_closed_at,
        as_of=now,
        half_life_days=parameters.half_life_days,
    )

    state = derive_state(
        estimate=estimate,
        uncertainty=uncertainty,
        effective_independent_count=effective_independent_count,
        effective_assisted_count=effective_assisted_count,
        last_outcome=last_outcome,
        parameters=parameters,
    )

    return LearnerEstimate(
        alpha=alpha,
        beta=beta,
        raw_mean=raw_mean,
        variance=variance,
        recency=recency,
        estimate=estimate,
        uncertainty=uncertainty,
        decay_risk=decay_risk,
        state=state,
        evidence_count=len(ordered),
        closed_evidence_count=closed_count,
        independent_count=effective_independent_count,
        assisted_count=effective_assisted_count,
        raw_independent_count=raw_independent_count,
        raw_assisted_count=raw_assisted_count,
        direct_taught_count=raw_count["direct_taught"],
        unresolved_count=raw_count["unresolved"],
        last_outcome=last_outcome,
        last_observed_at=last_observed_at,
        last_closed_at=last_closed_at,
        computed_at=now.isoformat(timespec="microseconds"),
    )


def project_snapshot_at(
    snapshot: dict[str, Any],
    *,
    as_of: datetime | str | None = None,
    parameters: ModelParameters = DEFAULT_PARAMETERS,
) -> dict[str, Any]:
    """Apply time decay to a stored snapshot without mutating persistence.

    Evidence and Beta parameters do not change as time passes.  A previously
    ``likely_ready`` snapshot can conservatively fall back to ``emerging``;
    time alone can never promote a weaker state or erase a latest-outcome
    safety guard captured during replay.
    """

    validate_model_parameters(parameters)
    value = dict(snapshot)
    alpha = float(value.get("alpha"))
    beta = float(value.get("beta"))
    now = _coerce_datetime(as_of) if as_of is not None else datetime.now(_UTC)
    raw_mean, variance, recency, estimate, uncertainty, decay_risk = _project_beta(
        alpha,
        beta,
        last_closed_at=value.get("last_closed_at"),
        as_of=now,
        half_life_days=parameters.half_life_days,
    )
    value.update({
        "raw_mean": raw_mean,
        "variance": variance,
        "recency": recency,
        "estimate": estimate,
        "uncertainty": uncertainty,
        "decay_risk": decay_risk,
    })
    last_outcome = value.get("last_outcome")
    if not last_outcome:
        # Snapshots written before the last_outcome migration are treated
        # conservatively rather than silently promoted by a read-time decay.
        if int(value.get("direct_taught_count") or 0) > 0:
            last_outcome = "direct_taught"
        elif int(value.get("unresolved_count") or 0) > 0:
            last_outcome = "unresolved"
    value["learner_state"] = derive_state(
        estimate=estimate,
        uncertainty=uncertainty,
        effective_independent_count=int(value.get("independent_count") or 0),
        effective_assisted_count=int(value.get("assisted_count") or 0),
        last_outcome=last_outcome,
        parameters=parameters,
    )
    return value


def derive_state(
    *,
    estimate: float,
    uncertainty: float,
    effective_independent_count: int,
    effective_assisted_count: int,
    last_outcome: str | None,
    parameters: ModelParameters = DEFAULT_PARAMETERS,
) -> str:
    """Derive the internal model state; estimate is the only numeric driver."""

    positive_count = effective_independent_count + effective_assisted_count
    if last_outcome == "direct_taught":
        return "model_needs_review"
    if positive_count == 0:
        return "unknown"
    if estimate < parameters.needs_review_estimate:
        return "model_needs_review"
    if last_outcome == "unresolved":
        return "emerging"
    if (
        estimate >= parameters.likely_ready_estimate
        and effective_independent_count >= parameters.likely_ready_independent_count
        and uncertainty <= parameters.likely_ready_uncertainty
    ):
        return "likely_ready"
    return "emerging"


def _project_beta(
    alpha: float,
    beta: float,
    *,
    last_closed_at: str | None,
    as_of: datetime,
    half_life_days: float,
) -> tuple[float, float, float, float, float, float]:
    _assert_beta_invariant(alpha, beta)
    recency = _recency(last_closed_at, as_of, half_life_days)
    _assert_unit_interval("recency", recency)
    raw_mean = alpha / (alpha + beta)
    _assert_unit_interval("raw_mean", raw_mean)
    variance = alpha * beta / ((alpha + beta) ** 2 * (alpha + beta + 1.0))
    _assert_variance_invariant(variance)
    estimate = 0.5 + (raw_mean - 0.5) * recency
    _assert_unit_interval("estimate", estimate)
    concentration = math.sqrt(max(0.0, min(1.0, 12.0 * variance)))
    uncertainty = _clamp(
        1.0 - (1.0 - concentration) * recency,
        0.0,
        1.0,
    )
    _assert_unit_interval("uncertainty", uncertainty)
    decay_risk = 1.0 if last_closed_at is None else _clamp(1.0 - recency, 0.0, 1.0)
    _assert_unit_interval("decay_risk", decay_risk)
    return raw_mean, variance, recency, estimate, uncertainty, decay_risk


def _recency(last_closed_at: str | None, as_of: datetime, half_life_days: float) -> float:
    if last_closed_at is None:
        return 0.0
    if half_life_days <= 0 or not math.isfinite(half_life_days):
        raise ValueError("half_life_days must be finite and positive")
    observed = _coerce_datetime(last_closed_at)
    days = max(0.0, (as_of - observed).total_seconds() / 86400.0)
    return _clamp(2.0 ** (-days / half_life_days), 0.0, 1.0)


def _timestamp_sort_key(value: Any) -> tuple[int, float, str]:
    parsed = _try_datetime(value)
    if parsed is None:
        return (0, 0.0, str(value or ""))
    return (1, parsed.timestamp(), parsed.isoformat())


def _timestamp_text(value: Any) -> str | None:
    if value is None or not str(value).strip():
        return None
    return str(value)


def _coerce_datetime(value: datetime | str) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value).strip()
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_UTC)
    return parsed.astimezone(_UTC)


def _try_datetime(value: Any) -> datetime | None:
    try:
        return _coerce_datetime(value) if value is not None and str(value).strip() else None
    except (TypeError, ValueError, OverflowError):
        return None


def _assert_beta_invariant(alpha: float, beta: float) -> None:
    if not all(math.isfinite(value) for value in (alpha, beta)):
        raise ValueError("Beta parameters must be finite")
    if alpha < 1.0 or beta < 1.0:
        raise ValueError("Beta parameters must remain >= 1")


def _assert_variance_invariant(variance: float) -> None:
    if not math.isfinite(variance) or variance < -_EPSILON or variance > (1.0 / 12.0) + _EPSILON:
        raise ValueError("Beta variance is outside the supported [0, 1/12] range")


def _assert_unit_interval(name: str, value: float) -> None:
    if not math.isfinite(value) or value < -_EPSILON or value > 1.0 + _EPSILON:
        raise ValueError(f"{name} is outside the supported [0, 1] range")


def _clamp(value: float, lower: float, upper: float) -> float:
    if not math.isfinite(value):
        raise ValueError("model value must be finite")
    return max(lower, min(upper, value))
