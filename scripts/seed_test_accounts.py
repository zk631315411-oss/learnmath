"""Materialize isolated internal test accounts from a sanitized template user.

The source database is modified in place, so callers should pass a release or
fixture copy rather than the developer's primary ``data/learning.db``. Existing
target accounts are rejected unless ``--replace`` is explicitly supplied.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import uuid
from pathlib import Path

from passlib.hash import sha256_crypt


ID_TABLES = (
    "chat_history",
    "evidence_turns",
    "manim_artifacts",
    "screenshot_context_cache",
    "learner_model_runs",
)
OTHER_TABLES = (
    "user_profiles",
    "learner_node_estimates",
    "learning_progress_revisions",
)


def user_id(con: sqlite3.Connection, username: str) -> str:
    row = con.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if not row:
        raise RuntimeError(f"template user not found: {username}")
    return str(row[0])


def columns(con: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in con.execute(f"PRAGMA table_info({table})")]


def delete_user_rows(con: sqlite3.Connection, uid: str) -> None:
    for table in (*ID_TABLES, *OTHER_TABLES):
        con.execute(f"DELETE FROM {table} WHERE user_id = ?", (uid,))
    con.execute("DELETE FROM users WHERE id = ?", (uid,))


def clone_account(
    con: sqlite3.Connection,
    source_uid: str,
    username: str,
    password_hash: str,
) -> dict[str, int | str]:
    new_uid = str(uuid.uuid4())
    con.execute(
        "INSERT INTO users(id, username, password_hash, device_id, is_anonymous) "
        "VALUES (?, ?, ?, ?, 0)",
        (new_uid, username, password_hash, f"{username}-device"),
    )

    id_maps: dict[str, dict[str, str]] = {}
    counts: dict[str, int | str] = {"username": username, "user_id": new_uid}

    for table in ID_TABLES:
        table_columns = columns(con, table)
        rows = con.execute(
            f"SELECT * FROM {table} WHERE user_id = ?", (source_uid,)
        ).fetchall()
        pk_map: dict[str, str] = {}
        id_maps[table] = pk_map
        user_index = table_columns.index("user_id")
        id_index = table_columns.index("id")
        chat_index = table_columns.index("chat_id") if "chat_id" in table_columns else None
        for row in rows:
            values = list(row)
            old_id = str(values[id_index])
            new_id = str(uuid.uuid4())
            pk_map[old_id] = new_id
            values[id_index] = new_id
            values[user_index] = new_uid
            if chat_index is not None and values[chat_index]:
                values[chat_index] = id_maps.get("chat_history", {}).get(
                    str(values[chat_index]), values[chat_index]
                )
            con.execute(
                f"INSERT INTO {table} ({','.join(table_columns)}) "
                f"VALUES ({','.join('?' for _ in table_columns)})",
                values,
            )
        counts[table] = len(rows)

    for table in ("user_profiles", "learner_node_estimates", "learning_progress_revisions"):
        table_columns = columns(con, table)
        rows = con.execute(
            f"SELECT * FROM {table} WHERE user_id = ?", (source_uid,)
        ).fetchall()
        user_index = table_columns.index("user_id")
        for row in rows:
            values = list(row)
            values[user_index] = new_uid
            con.execute(
                f"INSERT INTO {table} ({','.join(table_columns)}) "
                f"VALUES ({','.join('?' for _ in table_columns)})",
                values,
            )
        counts[table] = len(rows)
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--template-user", default="merged_test")
    parser.add_argument("--password", default="123456")
    parser.add_argument("--prefix", default="test_")
    parser.add_argument("--count", type=int, default=10)
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()
    if args.count < 1:
        raise SystemExit("--count must be positive")
    if not args.database.exists():
        raise SystemExit(f"database not found: {args.database}")

    con = sqlite3.connect(args.database)
    try:
        con.row_factory = sqlite3.Row
        source_uid = user_id(con, args.template_user)
        usernames = [f"{args.prefix}{index:03d}" for index in range(1, args.count + 1)]
        existing = [
            username
            for username in usernames
            if con.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone()
        ]
        if existing and not args.replace:
            raise SystemExit(
                "target accounts already exist; pass --replace to recreate: "
                + ", ".join(existing)
            )

        password_hash = sha256_crypt.hash(args.password)
        report: dict[str, object] = {
            "database": str(args.database),
            "template_user": args.template_user,
            "accounts": [],
            "password": "not stored; supplied at invocation",
        }
        con.execute("PRAGMA foreign_keys = OFF")
        con.execute("BEGIN")
        for username in usernames:
            row = con.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
            if row:
                delete_user_rows(con, str(row[0]))
            report["accounts"].append(clone_account(con, source_uid, username, password_hash))
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()

    report_path = args.database.with_suffix(args.database.suffix + ".test-accounts.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
