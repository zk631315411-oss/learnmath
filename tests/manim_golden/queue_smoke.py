"""End-to-end API queue smoke against Redis, dispatcher, and renderer."""
from __future__ import annotations

import json
import time

from cases import CASES
from app.config import config
from app.db.connection import init_db
from app.db.manim_artifact_db import create_artifact, get_artifact
from app.services.manim_queue import enqueue_artifact, reconcile_artifact


init_db()
name, source = CASES[0]
artifact = create_artifact(
    user_id="smoke-user",
    chat_id="smoke-chat",
    client_turn_id="smoke-turn",
    title=name,
    rationale="queue smoke",
    source_code=source,
    duration_seconds=12,
    quality="low",
)
job_id = enqueue_artifact(artifact["id"])
deadline = time.monotonic() + 60
while time.monotonic() < deadline:
    artifact = reconcile_artifact(get_artifact(artifact["id"]))
    if artifact["status"] in {"completed", "failed", "repair_pending"}:
        break
    time.sleep(0.5)

report = {
    "job_id": job_id,
    "artifact_id": artifact["id"],
    "status": artifact["status"],
    "video_path": artifact.get("video_path"),
    "poster_path": artifact.get("poster_path"),
}
print("QUEUE_SMOKE=" + json.dumps(report, ensure_ascii=False))
raise SystemExit(0 if artifact["status"] == "completed" else 1)
