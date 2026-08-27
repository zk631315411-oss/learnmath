import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.auth.jwt_handler import create_access_token
from app.config import config
from app.db.connection import init_db
from app.db.evidence_db import insert_evidence_rows
from app.db.learner_model_db import replay_user_textbook
from app.main import app
from app.services.agents.tools.retrieve_learning_memory_index import (
    build_retrieve_learning_memory_index_tool,
)
from app.services.learning.learning_memory_scope import (
    begin_memory_scope,
    reset_memory_scope,
)
from app.services.learning.learning_memory_service import retrieve_learning_memory_index
from app.services.learning.learner_model_service import _latest_observation_timestamp
from app.services.learning.catalog import catalog_node_ids


CATALOG_NODE = sorted(catalog_node_ids("gaodai_shang"))[0]


class LearnerModelApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.tmp.name) / "learning.db")
        self.db_patch = patch.object(config, "DB_PATH", self.db_path)
        self.db_patch.start()
        self.enabled_patch = patch.object(config, "LEARNER_MODEL_ENABLED", False)
        self.enabled_patch.start()
        self.debug_patch = patch.object(config, "LEARNER_MODEL_DEBUG", False)
        self.debug_patch.start()
        self.env_patch = patch.object(config, "APP_ENV", "development")
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        self.addCleanup(self.debug_patch.stop)
        self.addCleanup(self.enabled_patch.stop)
        self.addCleanup(self.db_patch.stop)
        self.addCleanup(self.tmp.cleanup)
        init_db()
        self.client = TestClient(app)
        self.catalog_node = CATALOG_NODE
        self.headers = {
            "Authorization": f"Bearer {create_access_token({'user_id': 'u1'})}"
        }

    def test_auth_and_unknown_textbook_errors_match_existing_contract(self):
        response = self.client.get("/api/learner-model?textbook_id=gaodai_shang")
        self.assertEqual(response.status_code, 401)
        response = self.client.get(
            "/api/learner-model?textbook_id=not-a-book", headers=self.headers,
        )
        self.assertEqual(response.status_code, 400)

    def test_disabled_is_neutral_200(self):
        response = self.client.get(
            "/api/learner-model?textbook_id=gaodai_shang", headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "disabled")
        self.assertFalse(body["available"])
        self.assertEqual(body["nodes"], [])

    def test_enabled_empty_user_is_available_without_fake_node(self):
        with patch.object(config, "LEARNER_MODEL_ENABLED", True):
            response = self.client.get(
                "/api/learner-model?textbook_id=gaodai_shang", headers=self.headers,
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertTrue(response.json()["available"])
        self.assertEqual(response.json()["nodes"], [])

    def test_new_evidence_is_reflected_immediately_in_model(self):
        insert_evidence_rows([{
            "id": "e1", "user_id": "u1", "node_id": self.catalog_node,
            "textbook_id": "gaodai_shang", "outcome": "independent",
            "scaffolding_level": 0,
        }])
        replay_user_textbook("u1", "gaodai_shang", node_ids=[self.catalog_node])
        insert_evidence_rows([{
            "id": "e2", "user_id": "u1", "node_id": self.catalog_node,
            "textbook_id": "gaodai_shang", "outcome": "assisted",
            "scaffolding_level": 1,
        }])
        with patch.object(config, "LEARNER_MODEL_ENABLED", True):
            response = self.client.get(
                "/api/learner-model?textbook_id=gaodai_shang", headers=self.headers,
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertTrue(body["available"])
        # The second evidence row is already part of the read-time estimate.
        node = next(item for item in body["nodes"] if item["node_id"] == self.catalog_node)
        self.assertEqual(node["learner_state"], "emerging")
        self.assertTrue(node["available"])

    def test_public_updated_at_is_last_observation_not_read_time(self):
        observed_at = "2026-01-01T00:00:00+00:00"
        insert_evidence_rows([{
            "id": "dated-evidence",
            "user_id": "u1",
            "node_id": self.catalog_node,
            "textbook_id": "gaodai_shang",
            "outcome": "independent",
            "scaffolding_level": 0,
            "created_at": observed_at,
        }])
        with patch.object(config, "LEARNER_MODEL_ENABLED", True):
            response = self.client.get(
                "/api/learner-model?textbook_id=gaodai_shang", headers=self.headers,
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["updated_at"], observed_at)
        self.assertEqual(response.json()["nodes"][0]["updated_at"], observed_at)

    def test_empty_public_overview_keeps_revision_for_catalog_external_rows(self):
        insert_evidence_rows([{
            "id": "external-evidence",
            "user_id": "u1",
            "node_id": "gaodai_shang:not-in-catalog",
            "textbook_id": "gaodai_shang",
            "outcome": "independent",
            "scaffolding_level": 0,
        }])
        with patch.object(config, "LEARNER_MODEL_ENABLED", True):
            response = self.client.get(
                "/api/learner-model?textbook_id=gaodai_shang", headers=self.headers,
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["nodes"], [])
        self.assertEqual(body["revision"], 1)

    def test_empty_public_overview_revision_failure_is_neutral(self):
        with patch.object(config, "LEARNER_MODEL_ENABLED", True), \
             patch(
                 "app.services.learning.learner_model_service.get_learning_progress_revision",
                 side_effect=RuntimeError("revision store unavailable"),
             ):
            response = self.client.get(
                "/api/learner-model?textbook_id=gaodai_shang", headers=self.headers,
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "unavailable")
        self.assertFalse(body["available"])
        self.assertEqual(body["nodes"], [])

    def test_enabled_replay_failure_is_neutral_200(self):
        insert_evidence_rows([{
            "id": "invalid-evidence", "user_id": "u1",
            "node_id": self.catalog_node, "textbook_id": "gaodai_shang",
            "outcome": "invalid", "scaffolding_level": 0,
        }])
        with patch.object(config, "LEARNER_MODEL_ENABLED", True):
            response = self.client.get(
                "/api/learner-model?textbook_id=gaodai_shang", headers=self.headers,
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "unavailable")
        self.assertFalse(response.json()["available"])
        self.assertEqual(response.json()["nodes"], [])

    def test_debug_fields_require_development_switch(self):
        insert_evidence_rows([{
            "id": "e1", "user_id": "u1", "node_id": self.catalog_node,
            "textbook_id": "gaodai_shang", "outcome": "independent",
            "scaffolding_level": 0,
        }])
        replay_user_textbook("u1", "gaodai_shang", node_ids=[self.catalog_node])
        with patch.object(config, "LEARNER_MODEL_ENABLED", True), \
             patch.object(config, "LEARNER_MODEL_DEBUG", True):
            response = self.client.get(
                "/api/learner-model?textbook_id=gaodai_shang&debug=true",
                headers=self.headers,
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn("alpha", response.json()["nodes"][0])
        with patch.object(config, "LEARNER_MODEL_ENABLED", True), \
             patch.object(config, "APP_ENV", "production"):
            response = self.client.get(
                "/api/learner-model?textbook_id=gaodai_shang&debug=true",
                headers=self.headers,
            )
        self.assertNotIn("alpha", response.json()["nodes"][0])

    def test_node_scope_rejects_cross_textbook_id(self):
        with patch.object(config, "LEARNER_MODEL_ENABLED", True):
            response = self.client.get(
                "/api/learner-model/nodes/gaoshu_shang:n?textbook_id=gaodai_shang",
                headers=self.headers,
            )
        self.assertEqual(response.status_code, 400)

    def test_node_scope_rejects_unknown_node_with_valid_textbook_prefix(self):
        with patch.object(config, "LEARNER_MODEL_ENABLED", True):
            response = self.client.get(
                "/api/learner-model/nodes/gaodai_shang:not-in-catalog?textbook_id=gaodai_shang",
                headers=self.headers,
            )
        self.assertEqual(response.status_code, 400)


class LearnerModelToolTests(unittest.TestCase):
    def test_tool_is_read_only_and_bounded(self):
        tool = build_retrieve_learning_memory_index_tool(
            user_id="u1", textbook_id="gaodai_shang",
        )
        self.assertEqual(tool.kind, "read_only")
        # 允许修正参数后重试 1 次（首次混入未 resolve 节点被 scope 拒绝后可再试），
        # scope 的 fail-closed 校验不变；见 retrieve_learning_memory_index.py。
        self.assertEqual(tool.max_calls_per_turn, 2)
        with self.assertRaises(Exception):
            tool.validate_arguments({
                "node_ids": [f"gaodai_shang:n{i}" for i in range(4)]
            })

    def test_tool_binds_user_and_textbook_and_public_result_hides_parameters(self):
        tool = build_retrieve_learning_memory_index_tool(
            user_id="bound-user", textbook_id="gaodai_shang",
        )
        with patch(
            "app.services.agents.tools.retrieve_learning_memory_index.retrieve_learning_memory_index",
            return_value={
                "status": "ok",
                "nodes": [{
                    "node_id": "gaodai_shang:n",
                    "mastery_view": {
                        "learner_state": "likely_ready",
                        "map_status": "mastered",
                        "stale": False,
                    },
                    "teaching_hint": {"recommended_action": "review_with_variation"},
                    "prerequisites": [],
                }],
            },
        ) as execute:
            result = tool.execute(node_ids=["gaodai_shang:n"])
        execute.assert_called_once_with(
            "bound-user", "gaodai_shang", ["gaodai_shang:n"], allowed_node_ids=None,
        )
        public = tool.present_result(result)
        self.assertNotIn("nodes", public)
        self.assertEqual(public["status"], "ok")
        self.assertEqual(public["node_count"], 1)

    def test_tool_rejects_nodes_not_resolved_by_current_kg_turn(self):
        resolved = {"gaodai_shang:resolved"}
        tool = build_retrieve_learning_memory_index_tool(
            user_id="u1",
            textbook_id="gaodai_shang",
            allowed_node_ids=resolved,
        )
        result = tool.execute(node_ids=["gaodai_shang:other"])
        self.assertEqual(result["status"], "invalid_scope")

    def test_replay_failure_returns_partial_memory_without_hint(self):
        scope, token = begin_memory_scope("u1", "gaodai_shang", qa_turn_id="turn-1")
        try:
            with patch.object(config, "LEARNER_MODEL_ENABLED", True), \
                 patch(
                     "app.services.learning.learning_memory_service.list_evidence_for_user_textbook_nodes",
                     return_value=[{
                         "id": "e1", "user_id": "u1", "node_id": CATALOG_NODE,
                         "textbook_id": "gaodai_shang", "outcome": "assisted",
                         "scaffolding_level": 1, "created_at": "2026-01-01T00:00:00+00:00",
                     }],
                 ), \
                 patch(
                     "app.services.learning.learning_memory_service.replay_node_evidence",
                     side_effect=RuntimeError("replay unavailable"),
                 ), \
                 patch(
                     "app.services.learning.learning_memory_service._prerequisite_context",
                     return_value=([], None, False),
                 ), \
                 patch(
                     "app.services.learning.learning_memory_service.project_user_progress",
                     return_value={"nodes": {}},
                 ):
                result = retrieve_learning_memory_index(
                    "u1", "gaodai_shang", [CATALOG_NODE],
                )
        finally:
            reset_memory_scope(token, scope)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(len(result["nodes"][0]["recent_observations"]), 1)
        self.assertTrue(result["nodes"][0]["mastery_view"]["stale"])
        self.assertNotIn("teaching_hint", result["nodes"][0])


if __name__ == "__main__":
    unittest.main()
