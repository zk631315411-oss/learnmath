"""Persistence for asynchronous Manim render artifacts."""
from __future__ import annotations

import hashlib
import uuid
from typing import Any

from app.config import config
from app.db.connection import get_conn, init_db
from app.services.manim_policy import validate_scene_source

STATUSES = {"queued", "running", "repair_pending", "repairing", "completed", "failed"}


def create_artifact(*, user_id: str, chat_id: str | None, client_turn_id: str | None,
                    title: str, rationale: str, source_code: str,
                    duration_seconds: float = 12, quality: str = "low") -> dict[str, Any]:
    policy = validate_scene_source(source_code, max_bytes=config.MANIM_MAX_SOURCE_BYTES)
    if not policy.ok:
        raise ValueError(f"{policy.code}: {policy.message}")
    init_db()
    artifact_id = str(uuid.uuid4())
    source_hash = hashlib.sha256(source_code.encode("utf-8")).hexdigest()
    conn = get_conn()
    try:
        conn.execute(
            """INSERT INTO manim_artifacts
               (id,user_id,chat_id,client_turn_id,title,rationale,source_code,source_hash,status,duration_seconds,quality)
               VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            (artifact_id, user_id, chat_id, client_turn_id, title[:160], rationale[:500],
             source_code, source_hash, "queued", duration_seconds, quality),
        )
        conn.commit()
        return get_artifact(artifact_id, user_id)
    finally:
        conn.close()


def get_artifact(artifact_id: str, user_id: str | None = None) -> dict[str, Any]:
    init_db()
    conn = get_conn()
    try:
        query = "SELECT * FROM manim_artifacts WHERE id=?"
        params: list[Any] = [artifact_id]
        if user_id is not None:
            query += " AND user_id=?"
            params.append(user_id)
        row = conn.execute(query, params).fetchone()
        if row is None:
            raise KeyError("manim artifact not found")
        return dict(row)
    finally:
        conn.close()


def list_artifacts_for_chat(chat_id: str, user_id: str) -> list[dict[str, Any]]:
    init_db()
    conn = get_conn()
    try:
        return [dict(row) for row in conn.execute(
            "SELECT * FROM manim_artifacts WHERE chat_id=? AND user_id=? ORDER BY created_at",
            (chat_id, user_id),
        ).fetchall()]
    finally:
        conn.close()


def update_artifact(artifact_id: str, *, status: str | None = None, attempt: int | None = None,
                    repair_count: int | None = None, rq_job_id: str | None = None,
                    video_path: str | None = None, poster_path: str | None = None,
                    error_code: str | None = None, error_message: str | None = None,
                    source_code: str | None = None, clear_rq_job_id: bool = False) -> dict[str, Any]:
    if status is not None and status not in STATUSES:
        raise ValueError("invalid manim artifact status")
    updates: list[str] = []
    values: list[Any] = []
    source_hash = hashlib.sha256(source_code.encode("utf-8")).hexdigest() if source_code is not None else None
    for name, value in (("status", status), ("attempt", attempt), ("repair_count", repair_count),
                        ("rq_job_id", rq_job_id), ("video_path", video_path),
                        ("poster_path", poster_path), ("error_code", error_code), ("error_message", error_message)):
        if value is not None:
            updates.append(f"{name}=?")
            values.append(value)
    if source_code is not None:
        updates.extend(["source_code=?", "source_hash=?"])
        values.extend([source_code, source_hash])
    if clear_rq_job_id:
        updates.append("rq_job_id=NULL")
    if not updates:
        return get_artifact(artifact_id)
    updates.append("updated_at=CURRENT_TIMESTAMP")
    values.append(artifact_id)
    conn = get_conn()
    try:
        conn.execute(f"UPDATE manim_artifacts SET {', '.join(updates)} WHERE id=?", values)
        conn.commit()
        return get_artifact(artifact_id)
    finally:
        conn.close()


def claim_artifact_status(artifact_id: str, expected: str, new_status: str) -> bool:
    if new_status not in STATUSES:
        raise ValueError("invalid manim artifact status")
    conn = get_conn()
    try:
        cursor = conn.execute(
            "UPDATE manim_artifacts SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=?",
            (new_status, artifact_id, expected),
        )
        conn.commit()
        return cursor.rowcount == 1
    finally:
        conn.close()


def count_active_artifacts(*, exclude_id: str | None = None) -> int:
    conn = get_conn()
    try:
        sql = "SELECT COUNT(*) FROM manim_artifacts WHERE status IN ('queued','running','repair_pending','repairing')"
        params: list[Any] = []
        if exclude_id:
            sql += " AND id<>?"
            params.append(exclude_id)
        return int(conn.execute(sql, params).fetchone()[0])
    finally:
        conn.close()


def migrate_artifact_user(old_user_id: str, new_user_id: str) -> int:
    conn = get_conn()
    try:
        cursor = conn.execute(
            "UPDATE manim_artifacts SET user_id=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?",
            (new_user_id, old_user_id),
        )
        conn.commit()
        return cursor.rowcount
    finally:
        conn.close()


def delete_artifacts_for_chat(chat_id: str, user_id: str) -> list[str]:
    artifacts = list_artifacts_for_chat(chat_id, user_id)
    conn = get_conn()
    try:
        conn.execute("DELETE FROM manim_artifacts WHERE chat_id=? AND user_id=?", (chat_id, user_id))
        conn.commit()
    finally:
        conn.close()
    return [path for item in artifacts for path in (item.get("video_path"), item.get("poster_path")) if path]
