"""Stable contracts for the explainable learner model.

The learner model consumes the existing ``evidence_turns`` fact rows.  These
types deliberately keep raw evidence, adapted observations, and computed
estimates separate so replay never mutates the fact ledger.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal


Outcome = Literal["independent", "assisted", "direct_taught", "unresolved"]
LearnerState = Literal["unknown", "emerging", "likely_ready", "model_needs_review"]


@dataclass(frozen=True)
class AdaptedEvidence:
    """One immutable evidence row after the versioned outcome mapping."""

    evidence_id: str
    node_id: str
    textbook_id: str
    raw_outcome: Outcome
    effective_outcome: Outcome
    scaffolding_level: int
    alpha_delta: float
    beta_delta: float
    effective_independent: bool
    effective_assisted: bool
    closed_observation: bool
    adaptation_reason: str


@dataclass(frozen=True)
class ModelParameters:
    """All values that affect replay and therefore belong to model_version."""

    adapter_version: str = "evidence-beta-v1"
    # v2 freezes the depth-two prerequisite aggregation contract alongside
    # the replay parameters.  The adapter itself remains wire-compatible v1.
    model_version: str = "learner-beta-v2"
    prior_alpha: float = 1.0
    prior_beta: float = 1.0
    half_life_days: float = 14.0
    likely_ready_estimate: float = 0.75
    likely_ready_uncertainty: float = 0.35
    likely_ready_independent_count: int = 2
    needs_review_estimate: float = 0.40
    prerequisite_risk_aggregation: str = "max-two-hop-v2"
    check_prerequisite_threshold: float = 0.60


@dataclass(frozen=True)
class LearnerEstimate:
    """Deterministic node estimate produced by replay."""

    alpha: float
    beta: float
    raw_mean: float
    variance: float
    recency: float
    estimate: float
    uncertainty: float
    decay_risk: float
    state: LearnerState
    evidence_count: int
    closed_evidence_count: int
    independent_count: int
    assisted_count: int
    raw_independent_count: int
    raw_assisted_count: int
    direct_taught_count: int
    unresolved_count: int
    last_outcome: Outcome | None
    last_observed_at: str | None
    last_closed_at: str | None
    # Evaluation timestamp, distinct from the timestamp of the latest
    # evidence row.  It makes read-time snapshots auditable without implying
    # that a new observation was created during the read.
    computed_at: str | None = None

    def as_dict(self) -> dict:
        return asdict(self)


DEFAULT_PARAMETERS = ModelParameters()
SUPPORTED_VERSION_PAIRS = frozenset({
    (DEFAULT_PARAMETERS.adapter_version, DEFAULT_PARAMETERS.model_version),
})


def validate_model_parameters(parameters: ModelParameters) -> None:
    """Reject unversioned math changes and unsupported adapter/model pairs.

    ``learner-beta-v2`` is an immutable contract.  A future implementation may
    add another supported pair, but it must not silently reinterpret a v2
    snapshot with different priors, thresholds, decay, or KG aggregation.
    """

    pair = (parameters.adapter_version, parameters.model_version)
    if pair not in SUPPORTED_VERSION_PAIRS:
        raise ValueError(
            "unsupported learner model version pair: "
            f"{parameters.adapter_version}/{parameters.model_version}"
        )
    if parameters != DEFAULT_PARAMETERS:
        raise ValueError(
            "learner-beta-v2 parameters changed without a model_version bump"
        )
