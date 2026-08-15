import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.config import config
from app.db.chat_history_db import get_chat_history, save_chat_history, update_chat_answer
from app.db.connection import init_db


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


if __name__ == "__main__":
    unittest.main()
