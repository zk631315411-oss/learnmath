"""修复 2/4 的最小单测：_prerequisite_context 二跳递归 + not_found 页名重试。

全部用 mock，不依赖 Neo4j / SQLite。
"""
import unittest
from unittest.mock import patch

from app.db import kg_v44
from app.services.learning import learner_model_service as lms


def _rel(node_id: str, name: str) -> dict:
    return {
        "node": {"node_id": node_id, "name": name},
        "relationship_type": "PREREQUISITE_OF",
        "direction": "incoming",
    }


def _estimate(estimate: float, state: str, evidence_count: int) -> dict:
    return {
        "estimate": estimate,
        "learner_state": state,
        "evidence_count": evidence_count,
    }


class TwoHopPrerequisiteTests(unittest.TestCase):
    """图谱：逆序数(B) -PREREQUISITE_OF-> 完全展开式(A) -PREREQUISITE_OF-> 定理(T)。"""

    def _run(self, progress_nodes, estimates, graph):
        def fake_relationships(node_id, *, focus, textbook_id, limit_per_group):
            return {"explicit_prerequisites": graph.get(node_id, [])}, {}

        def fake_estimate(user_id, textbook_id, node_id):
            return estimates[node_id]

        with patch.object(
            lms.kg_v44, "get_kg_relationships", side_effect=fake_relationships
        ), patch.object(
            lms, "compute_node_estimate", side_effect=fake_estimate
        ), patch.object(
            lms, "project_user_progress", return_value={"nodes": progress_nodes}
        ):
            return lms._prerequisite_context("u1", "book", "book:T")

    def test_second_hop_prerequisite_surfaces_with_hop_marker(self):
        contexts, risk, kg_available = self._run(
            progress_nodes={"book:B": {"status": "learning"}},
            estimates={
                "book:A": _estimate(0.6, "emerging", 1),
                "book:B": _estimate(0.5, "emerging", 1),
            },
            graph={
                "book:T": [_rel("book:A", "n阶行列式的完全展开式")],
                "book:A": [_rel("book:B", "逆序数")],
                "book:B": [],
            },
        )
        self.assertTrue(kg_available)
        by_id = {item["node_id"]: item for item in contexts}
        self.assertEqual(by_id["book:A"]["hop"], 1)
        self.assertEqual(by_id["book:B"]["hop"], 2)
        self.assertEqual(by_id["book:B"]["name"], "逆序数")
        self.assertEqual(by_id["book:B"]["map_status"], "learning")
        # 聚合口径覆盖两跳：max(1-0.6, 1-0.5) = 0.5
        self.assertAlmostEqual(risk, 0.5)

    def test_nodes_with_student_signal_sort_first(self):
        # A 无证据无地图状态（纯 KG 推断），B（二跳）有证据 → B 排在 A 前。
        contexts, _risk, _ = self._run(
            progress_nodes={"book:B": {"status": "learning"}},
            estimates={
                "book:A": _estimate(0.5, "unknown", 0),
                "book:B": _estimate(0.5, "emerging", 1),
            },
            graph={
                "book:T": [_rel("book:A", "n阶行列式的完全展开式")],
                "book:A": [_rel("book:B", "逆序数")],
                "book:B": [],
            },
        )
        self.assertEqual(contexts[0]["node_id"], "book:B")
        self.assertEqual(contexts[1]["node_id"], "book:A")

    def test_dedup_keeps_lowest_hop(self):
        # B 同时是 T 的直接前置和 A 的前置 → 只出现一次，hop=1。
        contexts, _risk, _ = self._run(
            progress_nodes={},
            estimates={
                "book:A": _estimate(0.5, "unknown", 0),
                "book:B": _estimate(0.5, "unknown", 0),
            },
            graph={
                "book:T": [_rel("book:A", "A"), _rel("book:B", "B")],
                "book:A": [_rel("book:B", "B")],
                "book:B": [],
            },
        )
        ids = [item["node_id"] for item in contexts]
        self.assertEqual(ids.count("book:B"), 1)
        self.assertEqual(next(i for i in contexts if i["node_id"] == "book:B")["hop"], 1)

    def test_first_hop_kg_failure_keeps_neutral_contract(self):
        with patch.object(
            lms.kg_v44, "get_kg_relationships", side_effect=RuntimeError("kg down")
        ), patch.object(
            lms, "project_user_progress", return_value={"nodes": {}}
        ):
            contexts, risk, kg_available = lms._prerequisite_context("u1", "book", "book:T")
        self.assertEqual(contexts, [])
        self.assertIsNone(risk)
        self.assertFalse(kg_available)


class PageNameRetryTests(unittest.TestCase):
    def test_sentence_query_corrected_to_page_node_name(self):
        names = [
            {"name": "n阶行列式的完全展开式"},
            {"name": "两行互换行列式反号"},
            {"name": "行列式对行数乘的分配性"},
        ]
        with patch(
            "app.services.learning.section_page.page_sections",
            return_value={61: "2.3"},
        ), patch.object(
            kg_v44, "list_kg_nodes_by_section", return_value=names
        ):
            corrected = kg_v44._correct_query_with_page_names(
                "交换行列式两行行列式变号", textbook_id="book", page_number=61,
            )
        self.assertIsNotNone(corrected)
        self.assertEqual(corrected[0], "两行互换行列式反号")

    def test_containment_match_preferred(self):
        with patch(
            "app.services.learning.section_page.page_sections",
            return_value={61: "2.3"},
        ), patch.object(
            kg_v44, "list_kg_nodes_by_section",
            return_value=[{"name": "两行互换行列式反号"}],
        ):
            corrected = kg_v44._correct_query_with_page_names(
                "请讲两行互换行列式反号为什么成立", textbook_id="book", page_number=61,
            )
        self.assertEqual(corrected[0], "两行互换行列式反号")

    def test_no_page_or_no_match_returns_none(self):
        self.assertIsNone(
            kg_v44._correct_query_with_page_names("任意问题", textbook_id="book", page_number=None)
        )
        with patch(
            "app.services.learning.section_page.page_sections",
            return_value={61: "2.3"},
        ), patch.object(
            kg_v44, "list_kg_nodes_by_section", return_value=[{"name": "特征值与特征向量"}]
        ):
            self.assertIsNone(
                kg_v44._correct_query_with_page_names(
                    "交换行列式两行行列式变号", textbook_id="book", page_number=61,
                )
            )


if __name__ == "__main__":
    unittest.main()
