"""Batch 1 生成状态契约测试：迁移、round-trip、follow-up turn、evidence 幂等。

覆盖 docs/FRONTEND_REVIEW_CONSOLIDATED.md Batch 1 验收项：
- 老库迁移后记录可读，状态为 completed；
- 根问题与追问的 pending/completed/interrupted/cancelled 均可 API round-trip；
- 更新接口可显式清空旧错误（None ≠ 未传）；
- 同一 client_turn_id 重试不重复写 evidence，revision 只递增一次。
"""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.config import config
from app.db.chat_history_db import (
    append_follow_up,
    get_chat_history,
    save_chat_history,
    update_chat_record,
    update_follow_up,
)
from app.db.connection import get_conn, init_db
from app.db.evidence_db import (
    get_learning_progress_revision,
    insert_evidence_rows,
    list_evidence_for_user_node,
)
from app.main import app


class TempDbTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self._tmp.name) / "learning.db")
        patcher = patch.object(config, "DB_PATH", self.db_path)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)


class GenerationStatusMigrationTests(TempDbTestCase):
    def _create_old_schema(self):
        """模拟 Batch 1 之前的老库：chat_history / evidence_turns 均无新列。"""
        conn = sqlite3.connect(self.db_path)
        conn.execute("""
            CREATE TABLE chat_history (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute(
            "INSERT INTO chat_history (id, user_id, question, answer) VALUES ('old1', 'u1', 'q', 'a')"
        )
        conn.execute("""
            CREATE TABLE evidence_turns (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                chat_id TEXT,
                qa_turn_id TEXT,
                node_id TEXT NOT NULL,
                textbook_id TEXT,
                scaffolding_level INTEGER,
                outcome TEXT NOT NULL,
                source TEXT NOT NULL,
                report_path TEXT NOT NULL,
                model_version TEXT,
                created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
            )
        """)
        conn.execute(
            "INSERT INTO evidence_turns (id, user_id, node_id, textbook_id, outcome, source, report_path) "
            "VALUES ('e1', 'u1', 'book:n', 'book', 'assisted', 'agent_self_report', '/tmp/r1.json')"
        )
        conn.commit()
        conn.close()

    def test_old_chat_history_migrates_to_completed(self):
        self._create_old_schema()
        init_db()
        conn = get_conn()
        try:
            columns = {row[1] for row in conn.execute("PRAGMA table_info(chat_history)").fetchall()}
            self.assertIn("generation_status", columns)
            self.assertIn("generation_error", columns)
            self.assertIn("generation_updated_at", columns)
            self.assertIn("client_turn_id", columns)
            row = conn.execute("SELECT * FROM chat_history WHERE id='old1'").fetchone()
            # 历史行自动迁为 completed，时间戳回灌为 created_at
            self.assertEqual(row["generation_status"], "completed")
            self.assertEqual(row["generation_updated_at"], row["created_at"])
            self.assertIsNone(row["generation_error"])
        finally:
            conn.close()

    def test_old_evidence_table_gets_client_turn_id_and_unique_index(self):
        self._create_old_schema()
        init_db()
        conn = get_conn()
        try:
            columns = {row[1] for row in conn.execute("PRAGMA table_info(evidence_turns)").fetchall()}
            self.assertIn("client_turn_id", columns)
            indexes = {row[1] for row in conn.execute("PRAGMA index_list(evidence_turns)").fetchall()}
            self.assertIn("idx_evidence_client_turn_node", indexes)
            # 老行 client_turn_id 为 NULL，不受唯一索引影响
            row = conn.execute("SELECT client_turn_id FROM evidence_turns WHERE id='e1'").fetchone()
            self.assertIsNone(row[0])
        finally:
            conn.close()

    def test_init_db_twice_is_idempotent_with_new_columns(self):
        init_db()
        init_db()


class GenerationStatusRoundTripTests(TempDbTestCase):
    def setUp(self):
        super().setUp()
        init_db()

    def test_save_defaults_pending_without_answer_and_completed_with_answer(self):
        pending_id = save_chat_history(user_id="u1", question="q1", client_turn_id="ct-1")
        done_id = save_chat_history(user_id="u1", question="q2", answer="a2")
        rows = {row["id"]: row for row in get_chat_history("u1")}
        self.assertEqual(rows[pending_id]["generation_status"], "pending")
        self.assertEqual(rows[pending_id]["client_turn_id"], "ct-1")
        self.assertIsNotNone(rows[pending_id]["generation_updated_at"])
        self.assertEqual(rows[done_id]["generation_status"], "completed")

    def test_save_with_same_client_turn_is_idempotent(self):
        first_id = save_chat_history(user_id="u1", question="q1", client_turn_id="same-turn")
        second_id = save_chat_history(user_id="u1", question="q1 retry", client_turn_id="same-turn")
        self.assertEqual(second_id, first_id)
        self.assertEqual(len(get_chat_history("u1")), 1)

    def test_update_record_supports_explicit_null_clear(self):
        chat_id = save_chat_history(user_id="u1", question="q", client_turn_id="ct-1")
        update_chat_record(chat_id, {"generation_status": "interrupted", "generation_error": "boom"})
        row = get_chat_history("u1", chat_id=chat_id)[0]
        self.assertEqual(row["generation_status"], "interrupted")
        self.assertEqual(row["generation_error"], "boom")
        # 显式 None = 清空旧错误；未出现的字段不动
        update_chat_record(chat_id, {"generation_status": "completed", "generation_error": None})
        row = get_chat_history("u1", chat_id=chat_id)[0]
        self.assertEqual(row["generation_status"], "completed")
        self.assertIsNone(row["generation_error"])

    def test_update_record_rejects_unknown_column(self):
        chat_id = save_chat_history(user_id="u1", question="q")
        with self.assertRaises(ValueError):
            update_chat_record(chat_id, {"user_id": "hack"})

    def test_follow_up_append_is_idempotent_and_update_merges(self):
        chat_id = save_chat_history(user_id="u1", question="q", answer="a")
        turn = {"turn_id": "t-1", "question": "为什么？", "status": "pending"}
        append_follow_up(chat_id, turn)
        appended = append_follow_up(chat_id, dict(turn))  # 重试/双击安全
        self.assertEqual(appended["status"], "pending")
        row = get_chat_history("u1", chat_id=chat_id)[0]
        self.assertEqual(len(json.loads(row["follow_ups"])), 1)

        updated = update_follow_up(chat_id, "t-1", {
            "answer": "因为……", "status": "completed", "error_message": None, "qa_turn_id": "qa-1",
        })
        self.assertEqual(updated["status"], "completed")
        self.assertEqual(updated["question"], "为什么？")  # 未出现的字段保留
        row = get_chat_history("u1", chat_id=chat_id)[0]
        stored = json.loads(row["follow_ups"])[0]
        self.assertEqual(stored["qa_turn_id"], "qa-1")

    def test_follow_up_missing_targets_return_none(self):
        self.assertIsNone(append_follow_up("no-such-chat", {"turn_id": "t", "question": "q"}))
        chat_id = save_chat_history(user_id="u1", question="q", answer="a")
        self.assertIsNone(update_follow_up(chat_id, "no-such-turn", {"status": "completed"}))


class ChatHistoryApiContractTests(TempDbTestCase):
    def setUp(self):
        super().setUp()
        init_db()
        self.client = TestClient(app)

    def test_root_and_follow_up_status_api_round_trip(self):
        # 根问题：POST 落 pending → PATCH completed（同时显式清空 generation_error）
        resp = self.client.post("/api/chat/history", json={
            "user_id": "u1", "question": "什么是秩？", "page_number": 1,
            "marker_y_ratio": 30, "marker_type": "text", "client_turn_id": "ct-root",
        })
        self.assertEqual(resp.status_code, 200)
        chat_id = resp.json()["id"]
        row = get_chat_history("u1", chat_id=chat_id)[0]
        self.assertEqual(row["generation_status"], "pending")

        resp = self.client.patch(f"/api/chat/history/{chat_id}", json={
            "answer": "秩是……", "generation_status": "completed", "generation_error": None,
            "sources": [{
                "textbook_id": "gaodai_shang", "textbook_name": "高等代数上册",
                "node_id": "n1", "node_name": "矩阵的秩", "chapter": "第3章",
                "section": "3.2 矩阵的秩", "source_code": "book:C03:S02",
                "snippet": "矩阵的秩定义如下。",
            }],
        })
        self.assertEqual(resp.status_code, 200)
        row = get_chat_history("u1", chat_id=chat_id)[0]
        self.assertEqual(row["generation_status"], "completed")
        self.assertIsNone(row["generation_error"])
        self.assertEqual(json.loads(row["sources"])[0]["node_id"], "n1")

        # 追问：POST pending（幂等）→ PATCH completed
        resp = self.client.post(f"/api/chat/history/{chat_id}/follow-ups", json={
            "turn_id": "t-1", "question": "为什么？", "status": "pending",
        })
        self.assertEqual(resp.status_code, 200)
        resp = self.client.post(f"/api/chat/history/{chat_id}/follow-ups", json={
            "turn_id": "t-1", "question": "为什么？", "status": "pending",
        })
        self.assertEqual(resp.status_code, 200)
        row = get_chat_history("u1", chat_id=chat_id)[0]
        self.assertEqual(len(json.loads(row["follow_ups"])), 1)

        resp = self.client.patch(f"/api/chat/history/{chat_id}/follow-ups/t-1", json={
            "answer": "因为……", "status": "completed", "qa_turn_id": "qa-1",
            "sources": [{
                "textbook_id": "gaodai_shang", "textbook_name": "高等代数上册",
                "node_id": "n2", "node_name": "逆序数", "chapter": "第2章",
                "section": "2.1 n 元排列", "source_code": "book:C02:S01",
                "snippet": "逆序数定义如下。",
            }],
        })
        self.assertEqual(resp.status_code, 200)
        stored = json.loads(get_chat_history("u1", chat_id=chat_id)[0]["follow_ups"])[0]
        self.assertEqual(stored["status"], "completed")
        self.assertEqual(stored["qa_turn_id"], "qa-1")
        self.assertEqual(stored["sources"][0]["node_name"], "逆序数")

        # 中断与取消也可 round-trip
        resp = self.client.patch(f"/api/chat/history/{chat_id}/follow-ups/t-1", json={
            "status": "interrupted", "error_message": "network down",
        })
        self.assertEqual(resp.status_code, 200)
        stored = json.loads(get_chat_history("u1", chat_id=chat_id)[0]["follow_ups"])[0]
        self.assertEqual(stored["status"], "interrupted")
        self.assertEqual(stored["error_message"], "network down")

        resp = self.client.patch(f"/api/chat/history/{chat_id}", json={"generation_status": "cancelled"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(get_chat_history("u1", chat_id=chat_id)[0]["generation_status"], "cancelled")

    def test_follow_up_endpoints_404_on_missing_records(self):
        resp = self.client.post("/api/chat/history/nope/follow-ups", json={"turn_id": "t", "question": "q"})
        self.assertEqual(resp.status_code, 404)
        chat_id = save_chat_history(user_id="u1", question="q", answer="a")
        resp = self.client.patch(f"/api/chat/history/{chat_id}/follow-ups/nope", json={"status": "completed"})
        self.assertEqual(resp.status_code, 404)

    def test_invalid_generation_status_rejected(self):
        chat_id = save_chat_history(user_id="u1", question="q")
        resp = self.client.patch(f"/api/chat/history/{chat_id}", json={"generation_status": "bogus"})
        self.assertEqual(resp.status_code, 422)


class EvidenceClientTurnIdempotencyTests(TempDbTestCase):
    def setUp(self):
        super().setUp()
        init_db()

    def _row(self, client_turn_id, qa_turn_id, node_id="book:n"):
        return {
            "user_id": "u1", "chat_id": "c1", "qa_turn_id": qa_turn_id,
            "client_turn_id": client_turn_id, "node_id": node_id,
            "textbook_id": "book", "outcome": "assisted", "source": "agent_self_report",
        }

    def test_same_client_turn_retry_does_not_duplicate_or_bump_revision(self):
        revisions = insert_evidence_rows([self._row("ct-1", "qa-1")])
        self.assertEqual(revisions[("u1", "book")], 1)
        # 同一 client turn 重试（新的服务端执行 ID）：不重复写、revision 不变
        revisions = insert_evidence_rows([self._row("ct-1", "qa-2")])
        rows = list_evidence_for_user_node("u1", "book:n")
        self.assertEqual(len(rows), 1)
        # 重试被 IGNORE：无 touched 行，返回空 revisions；库中 revision 保持 1
        self.assertEqual(revisions, {})
        self.assertEqual(get_learning_progress_revision("u1", "book"), 1)

    def test_different_client_turn_same_node_inserts_and_bumps(self):
        insert_evidence_rows([self._row("ct-1", "qa-1")])
        revisions = insert_evidence_rows([self._row("ct-2", "qa-2")])
        rows = list_evidence_for_user_node("u1", "book:n")
        self.assertEqual(len(rows), 2)
        self.assertEqual(revisions[("u1", "book")], 2)

    def test_rows_without_client_turn_id_never_deduped(self):
        # 老路径无 client_turn_id：保持原有「每次都插入」行为
        insert_evidence_rows([self._row(None, "qa-1")])
        insert_evidence_rows([self._row(None, "qa-2")])
        rows = list_evidence_for_user_node("u1", "book:n")
        self.assertEqual(len(rows), 2)


if __name__ == "__main__":
    unittest.main()
