import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.config import config
from app.db.connection import init_db
from app.db.evidence_db import (
    insert_evidence_rows,
    list_evidence_for_user,
    list_evidence_for_user_node,
)


class EvidenceDbTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        db_path = str(Path(self._tmp.name) / "learning.db")
        # 用临时库隔离，避免污染真实 data/learning.db
        patcher = patch.object(config, "DB_PATH", db_path)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)
        init_db()

    def test_init_db_is_idempotent(self):
        # 幂等建表：连续 init_db 两次不报错（表与索引均 IF NOT EXISTS）
        init_db()
        init_db()

    def test_insert_and_query_one_node(self):
        insert_evidence_rows([
            {
                "user_id": "u1",
                "chat_id": "c1",
                "qa_turn_id": "t1",
                "node_id": "gaodai_shang:线性无关",
                "textbook_id": "gaodai_shang",
                "scaffolding_level": 3,
                "outcome": "assisted",
                "source": "agent_self_report",
            }
        ])
        rows = list_evidence_for_user_node("u1", "gaodai_shang:线性无关")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["outcome"], "assisted")
        self.assertEqual(rows[0]["scaffolding_level"], 3)
        self.assertEqual(rows[0]["report_path"], "evidence_fork")

    def test_multiple_nodes_same_turn_each_one_row(self):
        insert_evidence_rows([
            {
                "user_id": "u1", "qa_turn_id": "t1",
                "node_id": "gaodai_shang:节点A", "textbook_id": "gaodai_shang",
                "scaffolding_level": 2, "outcome": "independent", "source": "agent_self_report",
            },
            {
                "user_id": "u1", "qa_turn_id": "t1",
                "node_id": "gaodai_shang:节点B", "textbook_id": "gaodai_shang",
                "scaffolding_level": 2, "outcome": "unresolved", "source": "agent_self_report",
            },
        ])
        rows = list_evidence_for_user("u1")
        self.assertEqual(len(rows), 2)
        self.assertEqual(
            {row["node_id"] for row in rows},
            {"gaodai_shang:节点A", "gaodai_shang:节点B"},
        )

    def test_time_ordering_ascending(self):
        # 依插入顺序时间序递增；list_evidence_for_user_node 应按 created_at 升序
        insert_evidence_rows([
            {"user_id": "u1", "node_id": "gaodai_shang:节点A", "textbook_id": "gaodai_shang",
             "scaffolding_level": 0, "outcome": "unresolved", "source": "agent_self_report"},
        ])
        insert_evidence_rows([
            {"user_id": "u1", "node_id": "gaodai_shang:节点A", "textbook_id": "gaodai_shang",
             "scaffolding_level": 1, "outcome": "independent", "source": "agent_self_report"},
        ])
        rows = list_evidence_for_user_node("u1", "gaodai_shang:节点A")
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["outcome"], "unresolved")
        self.assertEqual(rows[1]["outcome"], "independent")

    def test_filter_by_textbook(self):
        insert_evidence_rows([
            {"user_id": "u1", "node_id": "gaodai_shang:节点A", "textbook_id": "gaodai_shang",
             "scaffolding_level": 0, "outcome": "unresolved", "source": "agent_self_report"},
            {"user_id": "u1", "node_id": "gaoshu_shang:节点B", "textbook_id": "gaoshu_shang",
             "scaffolding_level": 0, "outcome": "unresolved", "source": "agent_self_report"},
        ])
        filtered = list_evidence_for_user("u1", textbook_id="gaodai_shang")
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]["node_id"], "gaodai_shang:节点A")

    def test_created_at_is_non_null_and_id_breaks_timestamp_ties(self):
        stamp = "2026-08-17T10:00:00.000000+00:00"
        insert_evidence_rows([
            {"id": "b", "user_id": "u1", "node_id": "book:n", "outcome": "assisted", "created_at": stamp},
            {"id": "a", "user_id": "u1", "node_id": "book:n", "outcome": "independent", "created_at": stamp},
            {"id": "c", "user_id": "u1", "node_id": "book:n", "outcome": "unresolved"},
        ])
        rows = list_evidence_for_user_node("u1", "book:n")
        tied = [row["id"] for row in rows if row["created_at"] == stamp]
        self.assertEqual(tied, ["a", "b"])
        self.assertTrue(all(row["created_at"] for row in rows))


if __name__ == "__main__":
    unittest.main()
