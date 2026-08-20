import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.auth.jwt_handler import create_access_token
from app.main import app


class LearningMapApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.token = create_access_token({"user_id": "token-user"})
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def test_requires_token_and_has_no_user_id_parameter(self):
        response = self.client.get("/api/learning-map/chapters?textbook_id=book&user_id=attacker")
        self.assertEqual(response.status_code, 401)

    def test_token_user_drives_evidence_query(self):
        with (
            patch("app.routers.learning_map.kg_v44.list_kg_chapter_nodes", return_value=[{"chapter": "第1章", "node_count": 1, "node_ids": ["book:n"]}]),
            patch("app.routers.learning_map.list_evidence_for_user", return_value=[]) as evidence,
        ):
            response = self.client.get("/api/learning-map/chapters?textbook_id=book", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        evidence.assert_called_once_with("token-user", textbook_id="book")
        body = response.json()["chapters"][0]
        self.assertEqual(body["exploration_progress"], {"explored": 0, "total": 1})
        self.assertEqual(body["status_counts"]["unexplored"], 1)

    def test_neo4j_failure_returns_map_unavailable(self):
        with patch("app.routers.learning_map.kg_v44.list_kg_chapter_nodes", side_effect=RuntimeError("down")):
            response = self.client.get("/api/learning-map/chapters?textbook_id=book", headers=self.headers)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "map_unavailable")


if __name__ == "__main__":
    unittest.main()
