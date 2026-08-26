import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.config import config
from app.main import app


class FeedbackApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data_patch = patch.object(config, "DATA_DIR", Path(self.tmp.name) / "data")
        self.data_patch.start()
        self.client = TestClient(app)
        self.addCleanup(self.data_patch.stop)
        self.addCleanup(self.tmp.cleanup)

    def test_accepts_anonymous_feedback_and_appends_daily_json(self):
        payload = {
            "rating": 5,
            "most_used_feature": "AI 问答",
            "problem_description": "截图提问很方便",
            "page_url": "http://localhost:5173/?view=map",
        }
        first = self.client.post("/api/feedback", json=payload, headers={"user-agent": "feedback-test"})
        second = self.client.post("/api/feedback", json={"rating": 3})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        files = list((Path(self.tmp.name) / "data" / "feedback").glob("*.json"))
        self.assertEqual(len(files), 1)
        records = json.loads(files[0].read_text(encoding="utf-8"))
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["rating"], 5)
        self.assertEqual(records[0]["user_agent"], "feedback-test")
        self.assertIn("timestamp", records[0])
        self.assertEqual(records[0]["page_url"], payload["page_url"])

    def test_rejects_invalid_rating_and_oversized_text(self):
        response = self.client.post("/api/feedback", json={"rating": 6})
        self.assertEqual(response.status_code, 422)
        response = self.client.post("/api/feedback", json={"rating": 4, "suggestion": "x" * 2001})
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
