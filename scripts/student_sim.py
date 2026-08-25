"""多轮学生模拟驱动：在同一 chat_id 内连续提问，供子代理扮演学生使用。

用法（单轮）：
    python scripts/student_sim.py --user student_solid --password test1234 \
        --chat-id <已有chat_id 或 new> --page 30 --question "..."
输出 JSON 到 stdout：{chat_id, answer, outcome_in_db}

设计：同一 chat_id 内多轮追问/作答，outcome 由系统 evidence fork 自评落库。
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

BASE = "http://127.0.0.1:8011"
DB = Path(__file__).resolve().parent.parent / "data" / "browser-test.db"


def _post_json(url: str, body: dict, timeout: int = 15) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def login(username: str, password: str) -> dict:
    return _post_json(f"{BASE}/api/auth/login", {"username": username, "password": password})


def run_turn(token: str, question: str, chat_id: str, page_number: int) -> dict:
    payload = {
        "token": token,
        "question": question,
        "teaching_mode": "socratic",
        "chat_id": chat_id,
        "textbook_id": "gaodai_shang",
        "page_number": page_number,
        "client_turn_id": f"sim{uuid.uuid4().hex[:20]}",
    }
    form = urllib.parse.urlencode({"payload": json.dumps(payload, ensure_ascii=False)}).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}/api/qa/solve-stream",
        data=form,
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "text/event-stream"},
        method="POST",
    )
    resp = urllib.request.urlopen(req, timeout=600)
    answer_parts: list[str] = []
    current_event = None
    for raw in resp:
        line = raw.decode("utf-8", errors="replace").strip()
        if not line:
            continue
        if line.startswith("event:"):
            current_event = line[6:].strip()
            continue
        if not line.startswith("data:"):
            continue
        try:
            obj = json.loads(line[5:].strip())
        except json.JSONDecodeError:
            continue
        if current_event == "content":
            for key in ("text", "delta", "content", "answer"):
                if isinstance(obj, dict) and isinstance(obj.get(key), str):
                    answer_parts.append(obj[key])
                    break
    return {"answer": "".join(answer_parts)}


def latest_outcome(user_id: str, chat_id: str) -> list[dict]:
    """读该 chat 最新写入的 evidence outcome（监督用）。"""
    try:
        conn = sqlite3.connect(str(DB))
        rows = conn.execute(
            "SELECT node_id, outcome, scaffolding_level, created_at FROM evidence_turns "
            "WHERE user_id=? AND chat_id=? ORDER BY created_at DESC LIMIT 5",
            (user_id, chat_id),
        ).fetchall()
        conn.close()
        return [{"node_id": r[0], "outcome": r[1], "scaffold": r[2], "at": r[3]} for r in rows]
    except Exception as exc:  # noqa: BLE001
        return [{"error": str(exc)}]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--chat-id", default="new")
    ap.add_argument("--page", type=int, default=30)
    ap.add_argument("--question", required=True)
    args = ap.parse_args()

    auth = login(args.user, args.password)
    chat_id = args.chat_id if args.chat_id != "new" else str(uuid.uuid4())
    result = run_turn(auth["access_token"], args.question, chat_id, args.page)
    time.sleep(1.5)  # 等 evidence fork 落库
    outcomes = latest_outcome(auth["user_id"], chat_id)
    print(json.dumps({
        "chat_id": chat_id,
        "user_id": auth["user_id"],
        "answer": result["answer"],
        "outcome_in_db": outcomes,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
