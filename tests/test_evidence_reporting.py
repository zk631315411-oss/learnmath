import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from app.config import config
from app.db import evidence_db
from app.db.connection import init_db
from app.db.chat_history_db import save_chat_history, update_chat_answer
from app.services.agents.tools.report_turn_outcome import (
    REPORT_TURN_OUTCOME_TOOL_NAME,
    ReportTurnOutcomeInput,
    build_report_turn_outcome_tool,
)
from app.services.agents.tool_def import ToolArgumentError
from app.services.qa import evidence_reporting
from app.services.learning.catalog import catalog_node_ids


CATALOG_NODE = sorted(catalog_node_ids("gaodai_shang"))[0]


class ReportTurnOutcomeToolTests(unittest.TestCase):
    def test_schema_accepts_one_to_three_nodes(self):
        model = ReportTurnOutcomeInput
        self.assertEqual(model.model_validate(
            {"node_ids": ["a"], "scaffolding_level": 0, "student_outcome": "independent"}
        ).node_ids, ["a"])
        self.assertEqual(
            len(model.model_validate({
                "node_ids": ["a", "b", "c"], "scaffolding_level": 4, "student_outcome": "unresolved",
            }).node_ids),
            3,
        )

    def test_schema_rejects_empty_or_too_many_nodes(self):
        with self.assertRaises(ValidationError):
            ReportTurnOutcomeInput.model_validate(
                {"node_ids": [], "scaffolding_level": 1, "student_outcome": "assisted"}
            )
        with self.assertRaises(ValidationError):
            ReportTurnOutcomeInput.model_validate(
                {"node_ids": ["a", "b", "c", "d"], "scaffolding_level": 1, "student_outcome": "assisted"}
            )

    def test_schema_rejects_out_of_range_scaffolding(self):
        with self.assertRaises(ValidationError):
            ReportTurnOutcomeInput.model_validate(
                {"node_ids": ["a"], "scaffolding_level": 5, "student_outcome": "assisted"}
            )
        with self.assertRaises(ValidationError):
            ReportTurnOutcomeInput.model_validate(
                {"node_ids": ["a"], "scaffolding_level": -1, "student_outcome": "assisted"}
            )

    def test_schema_rejects_unknown_outcome(self):
        with self.assertRaises(ValidationError):
            ReportTurnOutcomeInput.model_validate(
                {"node_ids": ["a"], "scaffolding_level": 1, "student_outcome": "mastered"}
            )

    def test_tool_arg_validation_raises_tool_argument_error(self):
        tool = build_report_turn_outcome_tool()
        self.assertEqual(tool.name, REPORT_TURN_OUTCOME_TOOL_NAME)
        self.assertIn("本次只能调用一次", tool.description)
        self.assertNotIn("分组多次调用", tool.description)
        with self.assertRaises(ToolArgumentError):
            tool.validate_arguments(
                {"node_ids": ["a", "b", "c", "d"], "scaffolding_level": 0, "student_outcome": "assisted"}
            )


class EvidenceReportingTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        db_path = str(Path(self._tmp.name) / "learning.db")
        patcher = patch.object(config, "DB_PATH", db_path)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)
        init_db()

    def test_extract_resolved_node_ids_only_accepts_selected_node(self):
        activities = [{
            "tool": "retrieve_kg_context",
            "result": {
                "status": "resolved",
                "selected_node": {"node_id": "gaodai_shang:主节点", "name": "主节点"},
                "relationships": {
                    "explicit_prerequisites": [{"node": {"node_id": "gaodai_shang:前置", "name": "前置"}}],
                },
            },
        }]
        ids = evidence_reporting.extract_resolved_node_ids(activities)
        self.assertEqual(ids, {"gaodai_shang:主节点"})

    def test_thread_context_keeps_full_set_and_recent_first_order(self):
        def activity(node_id):
            return [{
                "tool": "retrieve_kg_context",
                "result": {
                    "status": "resolved",
                    "selected_node": {"node_id": node_id},
                },
            }]

        chat_id = save_chat_history(
            user_id="u1",
            question="q",
            answer="a",
            tool_activities=json.dumps(activity("book:root")),
        )
        follow_ups = [
            {"tool_activities": activity("book:middle")},
            {"tool_activities": activity("book:latest")},
            {"tool_activities": activity("book:middle")},
        ]
        update_chat_answer(chat_id, follow_ups=json.dumps(follow_ups))

        full_set, recent_first = evidence_reporting.load_thread_resolved_node_context(
            chat_id, "u1",
        )
        self.assertEqual(full_set, {"book:root", "book:middle", "book:latest"})
        self.assertEqual(recent_first, ["book:middle", "book:latest", "book:root"])

    def test_candidate_selection_prioritizes_turn_then_recent_history_and_warns(self):
        with self.assertLogs("learnmath.evidence", level="WARNING") as captured:
            selected = evidence_reporting.select_evidence_candidate_node_ids(
                turn_node_ids=["book:current"],
                thread_node_ids_recent_first=[
                    "book:latest", "book:older", "book:oldest",
                ],
                user_id="u1",
                turn_id="t1",
            )
        self.assertEqual(selected, ["book:current", "book:latest", "book:older"])
        self.assertIn("book:oldest", "\n".join(captured.output))

        with patch.object(evidence_db, "insert_evidence_rows") as insert:
            written = evidence_reporting.validate_and_report(
                user_id="u1",
                chat_id="c1",
                qa_turn_id="t1",
                textbook_id="book",
                node_ids=["book:oldest"],
                scaffolding_level=0,
                outcome="unresolved",
                turn_resolved_node_ids={"book:current"},
                thread_resolved_node_ids={
                    "book:latest", "book:older", "book:oldest",
                },
            )
        self.assertEqual(written, 1)
        insert.assert_called_once()

        history_only = evidence_reporting.select_evidence_candidate_node_ids(
            turn_node_ids=[],
            thread_node_ids_recent_first=["book:latest", "book:older"],
            user_id="u1",
            turn_id="t2",
        )
        self.assertEqual(history_only, ["book:latest", "book:older"])

    def test_invalid_node_id_dropped_and_not_persisted(self):
        # 上报一个不在 resolved 集合中的编造 id：整体丢弃、不落库
        with patch.object(evidence_db, "insert_evidence_rows") as insert:
            written = evidence_reporting.validate_and_report(
                user_id="u1", chat_id="c1", qa_turn_id="t1",
                textbook_id="gaodai_shang",
                node_ids=["gaodai_shang:编造节点"],
                scaffolding_level=2, outcome="assisted",
                turn_resolved_node_ids=set(),
                thread_resolved_node_ids=set(),
            )
        self.assertEqual(written, 0)
        insert.assert_not_called()

    def test_valid_node_persisted_one_row(self):
        with patch.object(evidence_db, "insert_evidence_rows") as insert:
            written = evidence_reporting.validate_and_report(
                user_id="u1", chat_id="c1", qa_turn_id="t1",
                textbook_id="gaodai_shang",
                node_ids=[CATALOG_NODE],
                scaffolding_level=3, outcome="assisted",
                turn_resolved_node_ids={CATALOG_NODE},
                thread_resolved_node_ids=set(),
            )
        self.assertEqual(written, 1)
        insert.assert_called_once()
        row = insert.call_args[0][0][0]
        self.assertEqual(row["node_id"], CATALOG_NODE)
        self.assertEqual(row["outcome"], "assisted")
        self.assertEqual(row["source"], "agent_self_report")
        self.assertEqual(row["scaffolding_level"], 3)

    def test_prefix_mismatch_dropped(self):
        # node_id 前缀与绑定教材不符：丢弃
        with patch.object(evidence_db, "insert_evidence_rows") as insert:
            written = evidence_reporting.validate_and_report(
                user_id="u1", chat_id="c1", qa_turn_id="t1",
                textbook_id="gaodai_shang",
                node_ids=["gaoshu_shang:跨教材节点"],
                scaffolding_level=2, outcome="assisted",
                turn_resolved_node_ids={"gaoshu_shang:跨教材节点"},
                thread_resolved_node_ids=set(),
            )
        self.assertEqual(written, 0)
        insert.assert_not_called()

    def test_known_catalog_rejects_prefix_matching_external_node(self):
        external = "gaodai_shang:not-in-catalog"
        with patch.object(evidence_db, "insert_evidence_rows") as insert:
            written = evidence_reporting.validate_and_report(
                user_id="u1", chat_id="c1", qa_turn_id="t1",
                textbook_id="gaodai_shang",
                node_ids=[external],
                scaffolding_level=0, outcome="unresolved",
                turn_resolved_node_ids={external},
                thread_resolved_node_ids=set(),
            )
        self.assertEqual(written, 0)
        insert.assert_not_called()

    def test_duplicate_nodes_are_one_logical_report_without_client_turn_id(self):
        with patch.object(evidence_db, "insert_evidence_rows") as insert:
            written = evidence_reporting.validate_and_report(
                user_id="u1", chat_id="c1", qa_turn_id="t1",
                textbook_id="gaodai_shang",
                node_ids=[CATALOG_NODE, CATALOG_NODE],
                scaffolding_level=0, outcome="independent",
                turn_resolved_node_ids={CATALOG_NODE},
                thread_resolved_node_ids=set(),
            )
        self.assertEqual(written, 1)
        rows = insert.call_args[0][0]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["node_id"], CATALOG_NODE)

    def test_db_exception_is_swallowed(self):
        # 落库异常不得向上抛：返回 0 且不阻断
        def boom(_rows):
            raise RuntimeError("db down")

        with patch.object(evidence_db, "insert_evidence_rows", side_effect=boom):
            written = evidence_reporting.validate_and_report(
                user_id="u1", chat_id="c1", qa_turn_id="t1",
                textbook_id="gaodai_shang",
                node_ids=["gaodai_shang:真实节点"],
                scaffolding_level=0, outcome="unresolved",
                turn_resolved_node_ids={"gaodai_shang:真实节点"},
                thread_resolved_node_ids=set(),
            )
        self.assertEqual(written, 0)

    def test_thread_resolved_nodes_are_accepted(self):
        # 线程历史 resolved（本轮未再查询）仍视为合法来源
        with patch.object(evidence_db, "insert_evidence_rows") as insert:
            written = evidence_reporting.validate_and_report(
                user_id="u1", chat_id="c1", qa_turn_id="t2",
                textbook_id="gaodai_shang",
                node_ids=[CATALOG_NODE],
                scaffolding_level=2, outcome="direct_taught",
                turn_resolved_node_ids=set(),
                thread_resolved_node_ids={CATALOG_NODE},
            )
        self.assertEqual(written, 1)
        insert.assert_called_once()

    def test_turn_metrics_deduplicate_rows_and_never_exceed_one(self):
        summary = evidence_reporting.summarize_turn_metrics([
            {"qa_turn_id": "t1", "eligible": True, "fork_attempted": True, "fork_tool_succeeded": True, "evidence_persisted": 3},
            {"qa_turn_id": "t1", "eligible": True, "fork_attempted": True, "fork_tool_succeeded": True, "evidence_persisted": 1},
            {"qa_turn_id": "t2", "eligible": True, "fork_attempted": True, "fork_tool_succeeded": False, "evidence_persisted": 0},
            {"qa_turn_id": "t3", "eligible": False, "fork_attempted": True, "fork_tool_succeeded": True, "evidence_persisted": 2},
        ])
        self.assertEqual(summary["eligible_turns"], 2)
        self.assertEqual(summary["fork_attempt_rate"], 1.0)
        self.assertEqual(summary["fork_tool_success_rate"], 0.5)
        self.assertEqual(summary["effective_persistence"], 0.5)


if __name__ == "__main__":
    unittest.main()
