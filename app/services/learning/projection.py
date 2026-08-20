"""Deterministic projection from evidence history to learning-map states."""
from __future__ import annotations

from collections.abc import Iterable
from typing import Any

CLOSED_OUTCOMES = {"independent", "assisted", "direct_taught"}


def project_status(evidence: Iterable[dict[str, Any]]) -> str:
    """Return exactly one state for any evidence sequence."""
    rows = list(evidence)
    if not rows:
        return "unexplored"
    closed = [row.get("outcome") for row in rows if row.get("outcome") in CLOSED_OUTCOMES]
    if len(closed) < 2:
        return "learning"
    if closed[-2:] == ["independent", "independent"]:
        return "mastered"
    if closed[-1] == "direct_taught":
        return "needs_review"
    window = closed[-5:]
    assisted_or_taught = sum(value in {"assisted", "direct_taught"} for value in window)
    if assisted_or_taught > len(window) / 2:
        return "needs_review"
    return "basically_mastered"


def is_blocked(statuses: Iterable[str]) -> bool:
    """A node is blocked when all known prerequisites need review."""
    values = list(statuses)
    return bool(values) and all(value == "needs_review" for value in values)
