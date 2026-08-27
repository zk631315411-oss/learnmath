import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.config import config
from app.db.chat_history_db import save_chat_history
from app.db.connection import init_db
from app.db.evidence_db import insert_evidence_rows
from app.services.learning.catalog import catalog_node_ids
from app.services.learning.learning_memory_scope import (
    begin_memory_scope,
    get_memory_scope,
    reset_memory_scope,
)
from app.services.learning.learning_memory_service import (
    _memory_summary,
    retrieve_learning_memory_detail,
    retrieve_learning_memory_index,
)
from app.services.agents.tools import get_qa_tool_defs


class LearningMemoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(config, "DB_PATH", str(Path(self.tmp.name) / "learning.db"))
        self.db_patch.start()
        self.enabled_patch = patch.object(config, "LEARNER_MODEL_ENABLED", True)
        self.enabled_patch.start()
        self.addCleanup(self.enabled_patch.stop)
        self.addCleanup(self.db_patch.stop)
        self.addCleanup(self.tmp.cleanup)
        init_db()
        self.node = sorted(catalog_node_ids("gaodai_shang"))[0]
        self.user = "u1"
        self.book = "gaodai_shang"

    def _scope(self):
        return begin_memory_scope(self.user, self.book, qa_turn_id="turn-1")

    def test_memory_summary_compares_instants_across_timezones(self):
        rows = [
            {
                "id": "later",
                "outcome": "independent",
                "scaffolding_level": 0,
                "created_at": "2026-01-01T23:30:00-05:00",
            },
            {
                "id": "earlier",
                "outcome": "assisted",
                "scaffolding_level": 1,
                "created_at": "2026-01-02T02:00:00+00:00",
            },
        ]
        summary = _memory_summary(rows)
        self.assertEqual(summary["last_observed_at"], "2026-01-01T23:30:00-05:00")

    def test_index_registers_refs_and_detail_returns_safe_excerpt(self):
        chat_id = save_chat_history(
            self.user,
            "Q" * 250,
            answer="A" * 250,
            thinking="PRIVATE THINKING",
            tool_activities=json.dumps([{"tool": "retrieve_learning_memory_index", "result": {}}]),
            textbook_id=self.book,
        )
        insert_evidence_rows([{
            "id": "e1", "user_id": self.user, "chat_id": chat_id,
            "qa_turn_id": "turn-1", "node_id": self.node,
            "textbook_id": self.book, "outcome": "assisted", "scaffolding_level": 1,
            "created_at": "2026-01-01T00:00:00+00:00",
        }])
        scope, token = self._scope()
        try:
            with patch(
                "app.services.learning.learning_memory_service._prerequisite_context",
                return_value=([], 0.0, False),
            ), patch(
                "app.services.learning.learning_memory_service.project_user_progress",
                return_value={"nodes": {}},
            ):
                index = retrieve_learning_memory_index(self.user, self.book, [self.node])
            self.assertEqual(index["status"], "ok")
            ref = index["nodes"][0]["recent_observations"][0]["memory_ref"]
            self.assertTrue(scope.accepts(ref))
            detail = retrieve_learning_memory_detail(self.user, self.book, [ref])
        finally:
            reset_memory_scope(token, scope)
        self.assertEqual(detail["status"], "ok")
        observation = detail["observations"][0]
        self.assertEqual(len(observation["student_question"]), 200)
        self.assertEqual(len(observation["teacher_answer_excerpt"]), 200)
        self.assertTrue(observation["truncated"])
        self.assertNotIn("PRIVATE THINKING", json.dumps(detail, ensure_ascii=False))
        self.assertNotIn("tool_activities", json.dumps(detail, ensure_ascii=False))

    def test_detail_rejects_unregistered_or_cross_node_ref(self):
        insert_evidence_rows([{
            "id": "e1", "user_id": self.user, "node_id": self.node,
            "textbook_id": self.book, "outcome": "independent", "scaffolding_level": 0,
        }])
        scope, token = self._scope()
        try:
            result = retrieve_learning_memory_detail(self.user, self.book, [{
                "evidence_id": "e1", "node_id": self.node, "textbook_id": self.book,
            }])
        finally:
            reset_memory_scope(token, scope)
        self.assertEqual(result["status"], "invalid_scope")

    def test_scope_isolated_and_closed(self):
        first, first_token = begin_memory_scope("u1", self.book, qa_turn_id="a")
        try:
            first.register({"evidence_id": "e1", "node_id": self.node, "textbook_id": self.book})
            second, second_token = begin_memory_scope("u2", self.book, qa_turn_id="b")
            try:
                self.assertIs(get_memory_scope(), second)
                self.assertFalse(second.accepts({"evidence_id": "e1", "node_id": self.node, "textbook_id": self.book}))
            finally:
                reset_memory_scope(second_token, second)
            self.assertIs(get_memory_scope(), first)
            self.assertTrue(first.accepts({"evidence_id": "e1", "node_id": self.node, "textbook_id": self.book}))
        finally:
            reset_memory_scope(first_token, first)
        self.assertIsNone(get_memory_scope())

    def test_index_recent_observation_budget_is_global(self):
        nodes = sorted(catalog_node_ids(self.book))[:2]
        insert_evidence_rows([
            {
                "id": f"e-{i}", "user_id": self.user, "node_id": node,
                "textbook_id": self.book, "outcome": "assisted", "scaffolding_level": 1,
                "created_at": f"2026-01-0{i + 1}T00:00:00+00:00",
            }
            for i, node in enumerate(nodes)
        ])
        scope, token = self._scope()
        try:
            with patch(
                "app.services.learning.learning_memory_service._prerequisite_context",
                return_value=([], 0.0, False),
            ), patch(
                "app.services.learning.learning_memory_service.project_user_progress",
                return_value={"nodes": {}},
            ):
                result = retrieve_learning_memory_index(self.user, self.book, nodes)
        finally:
            reset_memory_scope(token, scope)
        self.assertLessEqual(
            sum(len(item["recent_observations"]) for item in result["nodes"]),
            5,
        )

    def test_index_reuses_request_local_result_for_same_nodes(self):
        insert_evidence_rows([{
            "id": "cache-e1", "user_id": self.user, "node_id": self.node,
            "textbook_id": self.book, "outcome": "assisted", "scaffolding_level": 1,
            "created_at": "2026-01-01T00:00:00+00:00",
        }])
        scope, token = self._scope()
        try:
            with patch(
                "app.services.learning.learning_memory_service._prerequisite_context",
                return_value=([], 0.0, False),
            ), patch(
                "app.services.learning.learning_memory_service.list_evidence_for_user_textbook_nodes",
                wraps=__import__(
                    "app.services.learning.learning_memory_service",
                    fromlist=["list_evidence_for_user_textbook_nodes"],
                ).list_evidence_for_user_textbook_nodes,
            ) as evidence_read:
                first = retrieve_learning_memory_index(self.user, self.book, [self.node])
                second = retrieve_learning_memory_index(self.user, self.book, [self.node])
            self.assertEqual(evidence_read.call_count, 1)
            self.assertEqual(first, second)
            # Callers receive copies, so mutating one response cannot poison
            # the cached response returned to the next caller.
            first["nodes"][0]["memory_summary"]["observation_count"] = 999
            third = retrieve_learning_memory_index(self.user, self.book, [self.node])
            self.assertEqual(third["nodes"][0]["memory_summary"]["observation_count"], 1)
        finally:
            reset_memory_scope(token, scope)

    def test_live_agent_registers_only_new_memory_tool_names(self):
        tools = get_qa_tool_defs(
            textbook_id=self.book,
            user_id=self.user,
            allowed_node_ids=set(),
        )
        names = [tool.name for tool in tools]
        self.assertIn("retrieve_learning_memory_index", names)
        self.assertIn("retrieve_learning_memory_detail", names)
        self.assertNotIn("retrieve_learner_model_context", names)

    def test_partial_index_closed_loop_with_detail(self):
        chat_id = save_chat_history(
            self.user,
            "Q" * 250,
            answer="A" * 250,
            thinking="PRIVATE THINKING",
            tool_activities=json.dumps([{"tool": "retrieve_learning_memory_index", "result": {}}]),
            textbook_id=self.book,
        )
        insert_evidence_rows([{
            "id": "e1", "user_id": self.user, "chat_id": chat_id,
            "qa_turn_id": "turn-1", "node_id": self.node,
            "textbook_id": self.book, "outcome": "assisted", "scaffolding_level": 1,
            "created_at": "2026-01-01T00:00:00+00:00",
        }])
        scope, token = self._scope()
        try:
            with patch(
                "app.services.learning.learning_memory_service.replay_node_evidence",
                side_effect=RuntimeError("replay unavailable"),
            ), patch(
                "app.services.learning.learning_memory_service._prerequisite_context",
                return_value=([], None, False),
            ), patch(
                "app.services.learning.learning_memory_service.project_user_progress",
                return_value={"nodes": {}},
            ):
                index = retrieve_learning_memory_index(self.user, self.book, [self.node])
                # detail must run inside the live scope; closing the scope in
                # finally happens after the assertions' data is collected.
                self.assertEqual(index["status"], "partial")
                ref = index["nodes"][0]["recent_observations"][0]["memory_ref"]
                detail = retrieve_learning_memory_detail(self.user, self.book, [ref])
        finally:
            reset_memory_scope(token, scope)
        self.assertEqual(detail["status"], "ok")
        self.assertEqual(len(detail["observations"]), 1)
        self.assertEqual(len(detail["observations"][0]["student_question"]), 200)
        self.assertIn("teacher_answer_excerpt", detail["observations"][0])

    def test_empty_allowed_node_ids_rejected(self):
        scope, token = self._scope()
        try:
            result = retrieve_learning_memory_index(
                self.user, self.book, [self.node], allowed_node_ids=set(),
            )
        finally:
            reset_memory_scope(token, scope)
        self.assertEqual(result["status"], "invalid_scope")
        self.assertEqual(result["reason"], "nodes_must_be_resolved_by_kg_in_this_turn")

    def test_concurrent_scopes_isolated_across_asyncio_threadpool(self):
        insert_evidence_rows([{
            "id": "e1", "user_id": "u1", "node_id": self.node,
            "textbook_id": self.book, "outcome": "assisted", "scaffolding_level": 1,
            "created_at": "2026-01-01T00:00:00+00:00",
        }])
        ref_u1 = {"evidence_id": "e1", "node_id": self.node, "textbook_id": self.book}
        gate = asyncio.Event()

        async def worker(user, accepted):
            scope, token = begin_memory_scope(user, self.book, qa_turn_id=f"turn-{user}")
            try:
                if user == "u1":
                    # Run registration through the same threadpool path the
                    # tool executor uses, so contextvars propagation is real.
                    await asyncio.to_thread(scope.register, ref_u1)
                    gate.set()
                    await asyncio.sleep(0.05)
                else:
                    await gate.wait()
                return await asyncio.to_thread(scope.accepts, ref_u1)
            finally:
                reset_memory_scope(token, scope)

        async def run_concurrently():
            return await asyncio.gather(worker("u1", True), worker("u2", False))

        results = asyncio.run(run_concurrently())
        self.assertEqual(results, [True, False])


if __name__ == "__main__":
    unittest.main()
