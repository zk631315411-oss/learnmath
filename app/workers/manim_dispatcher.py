"""Trusted RQ job that bridges Redis into the network-free render spool."""
from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path

from app.config import config
from app.services.manim_policy import validate_scene_source

_ARTIFACT_ID = re.compile(r"^[0-9a-fA-F-]{36}$")


def dispatch_manim_artifact(
    artifact_id: str,
    source_code: str,
    duration_seconds: float = 12,
    quality: str = "low",
) -> dict[str, str]:
    """Validate and atomically publish a render request; never imports Manim."""
    if not _ARTIFACT_ID.fullmatch(artifact_id):
        raise ValueError("invalid artifact id")
    policy = validate_scene_source(source_code, max_bytes=config.MANIM_MAX_SOURCE_BYTES)
    if not policy.ok:
        raise ValueError(policy.message)
    if not 1 <= float(duration_seconds) <= config.MANIM_MAX_DURATION_SECONDS:
        raise ValueError("invalid animation duration")
    if quality not in {"low", "medium"}:
        raise ValueError("invalid animation quality")

    pending = config.MANIM_SPOOL_DIR / "pending"
    pending.mkdir(parents=True, exist_ok=True)
    if (
        (config.MANIM_SPOOL_DIR / "deletions" / f"{artifact_id}.delete").is_file()
        or (config.MANIM_SPOOL_DIR / "deleted" / f"{artifact_id}.tombstone").is_file()
    ):
        raise RuntimeError("artifact was deleted")
    payload = {
        "artifact_id": artifact_id,
        "source_code": source_code,
        "duration_seconds": float(duration_seconds),
        "quality": quality,
    }
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=pending, prefix=f".{artifact_id}-", suffix=".tmp", delete=False,
    ) as handle:
        json.dump(payload, handle, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())
        temporary = Path(handle.name)
    target = pending / f"{artifact_id}.json"
    temporary.replace(target)
    return {"status": "dispatched", "request_path": str(target)}
