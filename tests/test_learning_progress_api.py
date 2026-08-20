import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.auth.jwt_handler import create_access_token
from app.main import app


class LearningProgressApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.token = create_access_token({"user_id": "progress-user"})
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def test_requires_bearer_token(self):
        response = self.client.get("/api/learning-progress?textbook_id=gaodai_shang")
        self.assertEqual(response.status_code, 401)

    def test_projects_only_token_user_without_kg(self):
        expected = {
            "textbook_id": "gaodai_shang",
            "catalog_version": "gaodai_shang-test",
            "revision": 4,
            "nodes": {
                "gaodai_shang:node:a": {
                    "status": "learning",
                    "closed_evidence_count": 1,
                    "last_activity_at": "2026-08-18T10:00:00",
                    "source_chat_id": "chat-a",
                }
            },
        }
        with patch("app.routers.learning_progress.project_user_progress", return_value=expected) as project, \
             patch("app.routers.learning_progress.decode_token", return_value={"user_id": "progress-user"}):
            response = self.client.get("/api/learning-progress?textbook_id=gaodai_shang&user_id=attacker", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)
        project.assert_called_once_with("progress-user", "gaodai_shang")

    def test_unknown_textbook_is_rejected_before_projection(self):
        with patch("app.routers.learning_progress.project_user_progress") as project:
            response = self.client.get("/api/learning-progress?textbook_id=not-a-book", headers=self.headers)
        self.assertEqual(response.status_code, 400)
        project.assert_not_called()


if __name__ == "__main__":
    unittest.main()
