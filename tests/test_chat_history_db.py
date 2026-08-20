import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.auth.jwt_handler import create_access_token
from app.config import config
from app.db.chat_history_db import get_chat_history, migrate_user_id, save_chat_history, update_chat_answer
from app.db.evidence_db import insert_evidence_rows, list_evidence_for_user
from app.db.connection import init_db
from app.main import app


class ChatHistoryTests(unittest.TestCase):
    def test_follow_ups_and_tool_activity_round_trip(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = str(Path(temp_dir) / "learning.db")
            with patch.object(config, "DB_PATH", db_path):
                init_db()
                chat_id = save_chat_history(
                    user_id="student",
                    question="什么是特征值？",
                    answer="先说说你的思路。",
                    tool_activities=json.dumps([{"tool": "retrieve_kg_context"}]),
                )
                follow_ups = [{
                    "question": "为什么？",
                    "answer": "我们从矩阵对向量的作用看。",
                    "thinking": "承接上一轮",
                    "tool_activities": [],
                }]
                update_chat_answer(chat_id, follow_ups=json.dumps(follow_ups, ensure_ascii=False))

                rows = get_chat_history("student", chat_id=chat_id)

        self.assertEqual(len(rows), 1)
        self.assertEqual(json.loads(rows[0]["follow_ups"]), follow_ups)
        self.assertEqual(
            json.loads(rows[0]["tool_activities"])[0]["tool"],
            "retrieve_kg_context",
        )

    def test_exact_chat_lookup_requires_matching_user(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(config, "DB_PATH", str(Path(temp_dir) / "learning.db")):
                init_db()
                chat_id = save_chat_history(user_id="owner", question="q", answer="a")
                self.assertEqual(len(get_chat_history("owner", chat_id=chat_id)), 1)
                self.assertEqual(get_chat_history("other", chat_id=chat_id), [])

    def test_migrate_user_id_moves_chat_and_evidence_together(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(config, "DB_PATH", str(Path(temp_dir) / "learning.db")):
                init_db()
                save_chat_history(user_id="anonymous", question="q", answer="a")
                insert_evidence_rows([{"user_id": "anonymous", "node_id": "book:n", "outcome": "assisted"}])
                count = migrate_user_id("anonymous", "registered")
                self.assertEqual(count, 1)
                self.assertEqual(len(get_chat_history("registered")), 1)
                self.assertEqual(len(list_evidence_for_user("registered")), 1)

    def test_migrate_api_derives_both_users_from_tokens(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(config, "DB_PATH", str(Path(temp_dir) / "learning.db")):
                init_db()
                save_chat_history(user_id="anonymous", question="q", answer="a")
                insert_evidence_rows([{"user_id": "anonymous", "node_id": "book:n", "outcome": "assisted"}])
                old_token = create_access_token({"user_id": "anonymous"})
                new_token = create_access_token({"user_id": "registered"})
                response = TestClient(app).post(
                    "/api/chat/migrate",
                    json={"old_token": old_token},
                    headers={"Authorization": f"Bearer {new_token}"},
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(len(list_evidence_for_user("registered")), 1)


if __name__ == "__main__":
    unittest.main()
