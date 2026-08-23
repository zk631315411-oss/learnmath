import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.config import config
from app.db.connection import get_conn, init_db
from app.db.evidence_db import get_learning_progress_revision, insert_evidence_rows
from app.db.learner_model_db import compute_node_estimate, replay_user_textbook
from app.services.learning.catalog import catalog_node_ids
from app.services.learning.learning_memory_scope import begin_memory_scope, reset_memory_scope
from app.services.learning.learning_memory_service import retrieve_learning_memory_index


class LearnerModelDbTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patch = patch.object(config, "DB_PATH", str(Path(self.tmp.name) / "learning.db"))
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.addCleanup(self.tmp.cleanup)
        init_db()
        self.catalog_node = sorted(catalog_node_ids("gaodai_shang"))[0]

    def _row(self, evidence_id, outcome="independent", client_turn_id=None, node="book:n"):
        return {
            "id": evidence_id,
            "user_id": "u1",
            "node_id": node,
            "textbook_id": "gaodai_shang",
            "outcome": outcome,
            "scaffolding_level": 0,
            "client_turn_id": client_turn_id,
        }

    def test_read_time_estimate_reflects_evidence_immediately(self):
        init_db()
        insert_evidence_rows([self._row("e1")])
        result = replay_user_textbook("u1", "gaodai_shang", node_ids=["book:n"])
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["input_revision"], 1)
        estimate = result["estimates"][0]
        self.assertEqual(estimate["evidence_count"], 1)
        # Nothing is persisted any more: estimates are recomputed at read
        # time and learner_model_runs stays empty.
        conn = get_conn()
        try:
            stored = conn.execute(
                "SELECT COUNT(*) FROM learner_node_estimates WHERE user_id='u1'"
            ).fetchone()[0]
            runs = conn.execute(
                "SELECT COUNT(*) FROM learner_model_runs"
            ).fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(stored, 0)
        self.assertEqual(runs, 0)

    def test_new_evidence_is_reflected_without_replay(self):
        insert_evidence_rows([self._row("e1")])
        before = compute_node_estimate("u1", "gaodai_shang", "book:n")
        insert_evidence_rows([self._row("e2", outcome="assisted")])
        after = compute_node_estimate("u1", "gaodai_shang", "book:n")
        self.assertEqual(before["evidence_count"], 1)
        self.assertEqual(after["evidence_count"], 2)
        self.assertNotEqual(before["estimate"], after["estimate"])

    def test_duplicate_client_turn_is_not_counted_twice(self):
        insert_evidence_rows([self._row("e1", client_turn_id="ct-1")])
        insert_evidence_rows([self._row("e2", client_turn_id="ct-1")])
        self.assertEqual(get_learning_progress_revision("u1", "gaodai_shang"), 1)
        result = replay_user_textbook("u1", "gaodai_shang", node_ids=["book:n"])
        self.assertEqual(result["estimates"][0]["evidence_count"], 1)
        self.assertEqual(result["estimates"][0]["alpha"], 2.0)
        self.assertEqual(result["input_revision"], 1)

    @patch("app.db.learner_model_db.list_evidence_for_user_textbook_nodes")
    def test_replay_uses_canonical_deduped_rows(self, list_evidence):
        earlier = self._row(
            "e1", client_turn_id="ct-1", node="book:n",
        )
        earlier["created_at"] = "2026-01-01T00:00:00+00:00"
        duplicate = self._row(
            "e2", outcome="direct_taught", client_turn_id="ct-1", node="book:n",
        )
        duplicate["created_at"] = "2026-01-02T00:00:00+00:00"
        list_evidence.return_value = [duplicate, earlier]

        result = replay_user_textbook("u1", "gaodai_shang", node_ids=["book:n"])
        estimate = result["estimates"][0]

        self.assertEqual(estimate["evidence_count"], 1)
        self.assertEqual(estimate["alpha"], 2.0)
        self.assertEqual(estimate["direct_taught_count"], 0)

    def test_invalid_evidence_fails_replay_without_persisting_anything(self):
        insert_evidence_rows([self._row("e1")])
        conn = get_conn()
        try:
            conn.execute(
                "UPDATE evidence_turns SET outcome='invalid' WHERE id='e1'"
            )
            conn.commit()
        finally:
            conn.close()

        with self.assertRaises(ValueError):
            replay_user_textbook("u1", "gaodai_shang", node_ids=["book:n"])
        conn = get_conn()
        try:
            stored = conn.execute(
                "SELECT COUNT(*) FROM learner_node_estimates WHERE user_id='u1'"
            ).fetchone()[0]
            runs = conn.execute(
                "SELECT COUNT(*) FROM learner_model_runs"
            ).fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(stored, 0)
        self.assertEqual(runs, 0)

    def test_prerequisite_risk_does_not_change_target_estimate(self):
        insert_evidence_rows([
            self._row("target-1", node=self.catalog_node),
            self._row("prereq-1", outcome="unresolved", node="gaodai_shang:pre"),
        ])
        target_before = compute_node_estimate("u1", "gaodai_shang", self.catalog_node)["estimate"]
        relationship = {
            "explicit_prerequisites": [{
                "node": {"node_id": "gaodai_shang:pre", "name": "前置"},
                "relationship_type": "PREREQUISITE_OF",
                "direction": "incoming",
            }]
        }
        with patch(
            "app.services.learning.learner_model_service.kg_v44.get_kg_relationships",
            return_value=(relationship, {}),
        ), patch.object(config, "LEARNER_MODEL_ENABLED", True):
            scope, token = begin_memory_scope("u1", "gaodai_shang", qa_turn_id="t1")
            try:
                context = retrieve_learning_memory_index(
                    "u1", "gaodai_shang", [self.catalog_node],
                )
            finally:
                reset_memory_scope(token, scope)
        target_after = compute_node_estimate("u1", "gaodai_shang", self.catalog_node)["estimate"]
        # Real-time replay includes time decay, so only a tiny elapsed-time
        # drift is allowed; a prerequisite read must not move the estimate.
        self.assertAlmostEqual(target_before, target_after, places=3)
        self.assertGreater(context["nodes"][0]["teaching_hint"]["prerequisite_risk"], 0.0)
        self.assertEqual(context["nodes"][0]["mastery_view"]["learner_state"], "emerging")

    def test_non_prerequisite_relationship_is_not_aggregated_as_risk(self):
        insert_evidence_rows([self._row("target-1", node=self.catalog_node)])
        relationship = {
            "explicit_prerequisites": [{
                "node": {"node_id": "gaodai_shang:pre", "name": "普通关系"},
                "relationship_type": "USES",
                "direction": "incoming",
            }]
        }
        with patch(
            "app.services.learning.learner_model_service.kg_v44.get_kg_relationships",
            return_value=(relationship, {}),
        ), patch.object(config, "LEARNER_MODEL_ENABLED", True):
            scope, token = begin_memory_scope("u1", "gaodai_shang", qa_turn_id="t2")
            try:
                context = retrieve_learning_memory_index(
                    "u1", "gaodai_shang", [self.catalog_node],
                )
            finally:
                reset_memory_scope(token, scope)
        self.assertEqual(context["nodes"][0]["teaching_hint"]["prerequisite_risk"], 0.0)

    def test_context_rejects_catalog_external_node_without_side_effects(self):
        with patch.object(config, "LEARNER_MODEL_ENABLED", True), patch(
            "app.services.learning.learner_model_service.kg_v44.get_kg_relationships",
        ) as kg:
            scope, token = begin_memory_scope("u1", "gaodai_shang", qa_turn_id="t3")
            try:
                result = retrieve_learning_memory_index(
                    "u1", "gaodai_shang", ["gaodai_shang:not-in-catalog"],
                )
            finally:
                reset_memory_scope(token, scope)

        self.assertEqual(result["status"], "invalid_scope")
        self.assertEqual(result["reason"], "node_not_in_textbook_catalog")
        kg.assert_not_called()
        conn = get_conn()
        try:
            count = conn.execute(
                """SELECT COUNT(*) FROM learner_node_estimates
                   WHERE user_id=? AND textbook_id=? AND node_id=?""",
                ("u1", "gaodai_shang", "gaodai_shang:not-in-catalog"),
            ).fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(count, 0)


if __name__ == "__main__":
    unittest.main()
