"""chat_history 教材隔离测试 — 覆盖 textbook_id 落库、按教材过滤查询与老库补列迁移。"""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.config import config
from app.db.chat_history_db import get_chat_history, save_chat_history
from app.db.connection import init_db


class TextbookIsolationTests(unittest.TestCase):
    def test_save_with_textbook_filters_by_textbook(self):
        """用例 A：带教材落库后，按所属教材能查到，按其他教材查不到。"""
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = str(Path(temp_dir) / "learning.db")
            with patch.object(config, "DB_PATH", db_path):
                init_db()
                save_chat_history(
                    user_id="student",
                    question="特征向量的几何意义？",
                    page_number=3,
                    textbook_id="gaodai_shang",
                )

                rows_same = get_chat_history("student", textbook_id="gaodai_shang")
                rows_other = get_chat_history("student", textbook_id="gaoshu")

        self.assertEqual(len(rows_same), 1)
        self.assertEqual(rows_same[0]["textbook_id"], "gaodai_shang")
        self.assertEqual(len(rows_other), 0)

    def test_legacy_null_data_visible_under_any_textbook(self):
        """用例 B：不带教材的老数据（NULL）在任意教材过滤下都可见。"""
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = str(Path(temp_dir) / "learning.db")
            with patch.object(config, "DB_PATH", db_path):
                init_db()
                save_chat_history(
                    user_id="student",
                    question="老数据提问",
                    page_number=7,
                )

                rows_gaodai = get_chat_history("student", textbook_id="gaodai_shang")
                rows_gaoshu = get_chat_history("student", textbook_id="gaoshu")
                rows_all = get_chat_history("student")

        self.assertEqual(len(rows_gaodai), 1)
        self.assertEqual(len(rows_gaoshu), 1)
        self.assertEqual(len(rows_all), 1)
        self.assertIsNone(rows_gaodai[0]["textbook_id"])

    def test_init_db_adds_textbook_id_to_legacy_table(self):
        """用例 C：老库（无 textbook_id 列）启动时补列，且老数据完整。"""
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = str(Path(temp_dir) / "learning.db")
            # 先手工建一张缺 textbook_id 列的旧表并写入老数据，模拟老库启动前状态
            conn = sqlite3.connect(db_path)
            conn.execute("""
                CREATE TABLE chat_history (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    question TEXT NOT NULL,
                    answer TEXT NOT NULL,
                    sources TEXT,
                    knowledge_points TEXT,
                    page_number INTEGER,
                    marker_y_ratio REAL,
                    marker_type TEXT DEFAULT 'screenshot',
                    thumbnail TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute(
                "INSERT INTO chat_history (id, user_id, question, answer, page_number) "
                "VALUES (?, ?, ?, ?, ?)",
                ("old-1", "student", "老库里的提问", "老答案", 5),
            )
            conn.commit()
            conn.close()

            with patch.object(config, "DB_PATH", db_path):
                init_db()

                # 迁移后列存在
                conn = sqlite3.connect(db_path)
                columns = {
                    row[1]
                    for row in conn.execute("PRAGMA table_info(chat_history)").fetchall()
                }
                conn.close()

                # 老数据迁移后仍可按教材过滤读到（NULL 保持全教材可见）
                rows = get_chat_history("student", textbook_id="gaodai_shang")

        self.assertIn("textbook_id", columns)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["question"], "老库里的提问")
        self.assertIsNone(rows[0]["textbook_id"])


if __name__ == "__main__":
    unittest.main()
