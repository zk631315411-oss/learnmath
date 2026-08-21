import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.config import config
from app.db.auth_db import save_user
from app.db.connection import init_db
from app.main import app


class AnonymousAuthTests(unittest.TestCase):
    def test_device_restores_only_one_anonymous_identity(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(config, "DB_PATH", str(Path(temp_dir) / "learning.db")):
                init_db()
                client = TestClient(app)

                first = client.post("/api/auth/anonymous", params={"device_id": "device-a"})
                second = client.post("/api/auth/anonymous", params={"device_id": "device-a"})

                self.assertEqual(first.status_code, 200)
                self.assertEqual(second.status_code, 200)
                self.assertTrue(first.json()["is_anonymous"])
                self.assertEqual(first.json()["user_id"], second.json()["user_id"])

    def test_formal_account_on_device_is_not_returned_as_anonymous(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(config, "DB_PATH", str(Path(temp_dir) / "learning.db")):
                init_db()
                self.assertTrue(save_user("formal-user", "formal", "hash", "device-b", is_anonymous=False))
                client = TestClient(app)

                response = client.post("/api/auth/anonymous", params={"device_id": "device-b"})

                self.assertEqual(response.status_code, 200)
                self.assertNotEqual(response.json()["user_id"], "formal-user")
                self.assertTrue(response.json()["is_anonymous"])

    def test_anonymous_device_index_rejects_duplicate_rows(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(config, "DB_PATH", str(Path(temp_dir) / "learning.db")):
                init_db()
                self.assertTrue(save_user("anonymous-a", "user_a", "hash", "device-c", is_anonymous=True))
                self.assertFalse(save_user("anonymous-b", "user_b", "hash", "device-c", is_anonymous=True))


if __name__ == "__main__":
    unittest.main()
