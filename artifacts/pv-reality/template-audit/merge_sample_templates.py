"""Build a sanitized, merged fixture from known sample learner accounts.

The source database is copied first.  The source accounts remain intact in the
copy for traceability; valid user-scoped rows are additionally merged into the
existing ``merged_test`` account.  This script never mutates the source DB.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import uuid
from collections import defaultdict
from pathlib import Path


SAMPLE_USERS = ("student_solid", "student_struggle", "kz", "tester_qa")
USER_SCOPED_TABLES = (
    "chat_history",
    "evidence_turns",
    "manim_artifacts",
    "screenshot_context_cache",
    "learner_model_runs",
)


def uid(con: sqlite3.Connection, username: str) -> str:
    row = con.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if not row:
        raise RuntimeError(f"missing user: {username}")
    return row[0]


def json_merge(values: list[str | None]) -> str:
    result: list[object] = []
    seen: set[str] = set()
    for value in values:
        if not value:
            continue
        try:
            parsed = json.loads(value)
        except (TypeError, json.JSONDecodeError):
            continue
        items = parsed if isinstance(parsed, list) else [parsed]
        for item in items:
            marker = json.dumps(item, ensure_ascii=False, sort_keys=True)
            if marker not in seen:
                seen.add(marker)
                result.append(item)
    return json.dumps(result, ensure_ascii=False)


def clean_failed_rows(con: sqlite3.Connection, source_ids: list[str]) -> dict[str, list[str]]:
    placeholders = ",".join("?" for _ in source_ids)
    removed: dict[str, list[str]] = {"chat_history": [], "manim_artifacts": []}
    chats = con.execute(
        f"SELECT id FROM chat_history WHERE user_id IN ({placeholders}) "
        "AND (generation_status <> 'completed' OR COALESCE(generation_error, '') <> '')",
        source_ids,
    ).fetchall()
    for row in chats:
        removed["chat_history"].append(row[0])
    if removed["chat_history"]:
        marks = ",".join("?" for _ in removed["chat_history"])
        con.execute(f"DELETE FROM chat_history WHERE id IN ({marks})", removed["chat_history"])

    artifacts = con.execute(
        f"SELECT id FROM manim_artifacts WHERE user_id IN ({placeholders}) "
        "AND (status <> 'completed' OR COALESCE(error_code, '') <> '' "
        "OR COALESCE(error_message, '') <> '' OR video_path IS NULL)",
        source_ids,
    ).fetchall()
    for row in artifacts:
        removed["manim_artifacts"].append(row[0])
    if removed["manim_artifacts"]:
        marks = ",".join("?" for _ in removed["manim_artifacts"])
        con.execute(f"DELETE FROM manim_artifacts WHERE id IN ({marks})", removed["manim_artifacts"])
    return removed


def merge_rows(con: sqlite3.Connection, source_ids: list[str], target_id: str) -> dict[str, int]:
    placeholders = ",".join("?" for _ in source_ids)
    counts: dict[str, int] = {}
    id_map: dict[str, str] = {}
    # Insert chats first so evidence/artifacts can retain their relationships.
    for table in ("chat_history", "evidence_turns", "manim_artifacts", "screenshot_context_cache", "learner_model_runs"):
        rows = con.execute(f"SELECT * FROM {table} WHERE user_id IN ({placeholders})", source_ids).fetchall()
        moved = 0
        columns = [d[1] for d in con.execute(f"PRAGMA table_info({table})")]
        user_index = columns.index("user_id")
        for row in rows:
            values = list(row)
            values[user_index] = target_id
            old_pk = values[0]
            new_pk = str(uuid.uuid4())
            values[0] = new_pk
            id_map[f"{table}:{old_pk}"] = new_pk
            if "chat_id" in columns:
                chat_idx = columns.index("chat_id")
                old_chat = values[chat_idx]
                if old_chat:
                    values[chat_idx] = id_map.get(f"chat_history:{old_chat}", old_chat)
            con.execute(
                f"INSERT INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
                values,
            )
            moved += 1
        counts[table] = moved

    # Merge profile metadata without inventing a profile for accounts that had
    # none.  The target profile is optional in the app schema.
    profiles = con.execute(
        f"SELECT grade,weak_points,strong_points,learning_preferences FROM user_profiles "
        f"WHERE user_id IN ({placeholders})", source_ids
    ).fetchall()
    if profiles:
        grade = next((r[0] for r in profiles if r[0]), "")
        weak = json_merge([r[1] for r in profiles])
        strong = json_merge([r[2] for r in profiles])
        prefs = next((r[3] for r in profiles if r[3]), "{}")
        con.execute("DELETE FROM user_profiles WHERE user_id = ?", (target_id,))
        con.execute(
            "INSERT INTO user_profiles(user_id,grade,weak_points,strong_points,learning_preferences) "
            "VALUES (?,?,?,?,?)", (target_id, grade, weak, strong, prefs)
        )
        counts["user_profiles"] = 1

    # Estimates share a composite primary key.  Aggregate evidence counters,
    # retain the latest observation, and mark the result stale for a normal
    # learner-model recomputation on first login.
    estimate_rows = con.execute(
        f"SELECT * FROM learner_node_estimates WHERE user_id IN ({placeholders})", source_ids
    ).fetchall()
    estimate_columns = [d[1] for d in con.execute("PRAGMA table_info(learner_node_estimates)")]
    grouped: dict[tuple[str, str, str], list[sqlite3.Row]] = defaultdict(list)
    for row in estimate_rows:
        grouped[(row[1], row[2], row[5])].append(row)  # textbook_id, node_id, model_version
    con.execute("DELETE FROM learner_node_estimates WHERE user_id = ?", (target_id,))
    for (textbook_id, node_id, model_version), group in grouped.items():
        base = dict(group[0])
        base["user_id"] = target_id
        for field in (
            "evidence_count", "closed_evidence_count", "independent_count", "assisted_count",
            "raw_independent_count", "raw_assisted_count", "direct_taught_count", "unresolved_count",
        ):
            base[field] = sum(int(r[field] or 0) for r in group)
        latest = max(group, key=lambda r: r["last_observed_at"] or "")
        base["last_observed_at"] = latest["last_observed_at"]
        base["last_outcome"] = latest["last_outcome"]
        base["stale"] = 1
        values = [base[c] for c in estimate_columns]
        con.execute(
            f"INSERT INTO learner_node_estimates ({','.join(estimate_columns)}) "
            f"VALUES ({','.join('?' for _ in estimate_columns)})", values
        )
    counts["learner_node_estimates"] = len(grouped)

    # Some historical sample evidence was generated without retaining its
    # chat row.  Keep the evidence as standalone observations, but clear the
    # dangling chat reference in the merged fixture so integrity checks pass.
    dangling = con.execute(
        "SELECT e.id FROM evidence_turns e LEFT JOIN chat_history c ON c.id = e.chat_id "
        "WHERE e.user_id = ? AND e.chat_id IS NOT NULL AND c.id IS NULL", (target_id,)
    ).fetchall()
    if dangling:
        con.execute(
            "UPDATE evidence_turns SET chat_id = NULL WHERE user_id = ? AND chat_id IS NOT NULL "
            "AND NOT EXISTS (SELECT 1 FROM chat_history c WHERE c.id = evidence_turns.chat_id)",
            (target_id,),
        )
    counts["dangling_evidence_chat_refs_cleared"] = len(dangling)

    dangling_manim = con.execute(
        "SELECT m.id FROM manim_artifacts m LEFT JOIN chat_history c ON c.id = m.chat_id "
        "WHERE m.user_id = ? AND m.chat_id IS NOT NULL AND c.id IS NULL", (target_id,)
    ).fetchall()
    if dangling_manim:
        con.execute(
            "UPDATE manim_artifacts SET chat_id = NULL WHERE user_id = ? AND chat_id IS NOT NULL "
            "AND NOT EXISTS (SELECT 1 FROM chat_history c WHERE c.id = manim_artifacts.chat_id)",
            (target_id,),
        )
    counts["dangling_manim_chat_refs_cleared"] = len(dangling_manim)

    # Revisions are one row per textbook; retain the highest source revision.
    revisions = con.execute(
        f"SELECT textbook_id, MAX(revision) FROM learning_progress_revisions "
        f"WHERE user_id IN ({placeholders}) GROUP BY textbook_id", source_ids
    ).fetchall()
    con.execute("DELETE FROM learning_progress_revisions WHERE user_id = ?", (target_id,))
    for textbook_id, revision in revisions:
        con.execute(
            "INSERT INTO learning_progress_revisions(user_id,textbook_id,revision) VALUES (?,?,?)",
            (target_id, textbook_id, revision),
        )
    counts["learning_progress_revisions"] = len(revisions)
    return counts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.source, args.output)

    con = sqlite3.connect(args.output)
    con.row_factory = sqlite3.Row
    try:
        source_ids = [uid(con, name) for name in SAMPLE_USERS]
        target_id = uid(con, "merged_test")
        con.execute("PRAGMA foreign_keys = OFF")
        con.execute("BEGIN")
        removed = clean_failed_rows(con, source_ids)
        moved = merge_rows(con, source_ids, target_id)
        con.commit()
    finally:
        con.close()

    report = {
        "source": str(args.source),
        "output": str(args.output),
        "sample_users": list(SAMPLE_USERS),
        "target_user": "merged_test",
        "removed_failed_rows": removed,
        "merged_rows": moved,
        "notes": [
            "Source accounts remain in the copied DB for auditability.",
            "learner_node_estimates are marked stale=1 and should be recomputed by the learner model.",
            "No formal PV account was included.",
        ],
    }
    args.output.with_suffix(".report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
