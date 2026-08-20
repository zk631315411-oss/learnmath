import unittest
from concurrent.futures import TimeoutError as FutureTimeoutError
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

from app.auth.jwt_handler import create_access_token
from app.main import app
from app.services.learning import section_page


EMPTY_RESULT = {"page": None, "confidence": 0, "matched_text": None}


class SectionPageServiceTests(unittest.TestCase):
    def setUp(self):
        section_page.clear_section_page_cache()

    def tearDown(self):
        section_page.clear_section_page_cache()

    def test_hit_is_returned_and_cached(self):
        expected = {"page": 42, "confidence": 1.0, "matched_text": "3.1 向量空间"}
        with patch.object(section_page, "_scan", return_value=expected) as scan:
            first = section_page.resolve_section_page("gaodai_shang", "3.1")
            second = section_page.resolve_section_page("gaodai_shang", "3.1")
        self.assertEqual(first, expected)
        self.assertEqual(second, expected)
        scan.assert_called_once_with("gaodai_shang", "3.1")

    def test_miss_is_returned(self):
        with patch.object(section_page, "_scan", return_value=EMPTY_RESULT):
            self.assertEqual(
                section_page.resolve_section_page("gaodai_shang", "99.1"),
                EMPTY_RESULT,
            )

    def test_timeout_is_not_cached(self):
        timed_out = Mock()
        timed_out.result.side_effect = FutureTimeoutError
        succeeded = Mock()
        succeeded.result.return_value = {"page": 8, "confidence": 1.0, "matched_text": "1.1"}
        with patch.object(section_page._executor, "submit", side_effect=[timed_out, succeeded]) as submit:
            self.assertEqual(
                section_page.resolve_section_page("gaodai_shang", "1.1", timeout_seconds=0.001),
                EMPTY_RESULT,
            )
            self.assertEqual(section_page.resolve_section_page("gaodai_shang", "1.1")["page"], 8)
        timed_out.cancel.assert_called_once_with()
        self.assertEqual(submit.call_count, 2)


class SectionPageApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        token = create_access_token({"user_id": "section-page-user"})
        self.headers = {"Authorization": f"Bearer {token}"}

    def test_requires_authentication(self):
        response = self.client.get("/api/textbook/section-page?textbook_id=gaodai_shang&section=1.1")
        self.assertEqual(response.status_code, 401)

    def test_rejects_unknown_textbook(self):
        response = self.client.get(
            "/api/textbook/section-page?textbook_id=unknown&section=1.1",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 400)

    def test_rejects_non_numeric_section(self):
        response = self.client.get(
            "/api/textbook/section-page?textbook_id=gaodai_shang&section=chapter-one",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 400)

    def test_returns_resolver_contract(self):
        expected = {"page": 12, "confidence": 1.0, "matched_text": "1.1 线性方程组"}
        with patch("app.routers.textbook.resolve_section_page", return_value=expected):
            response = self.client.get(
                "/api/textbook/section-page?textbook_id=gaodai_shang&section=1.1",
                headers=self.headers,
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)


if __name__ == "__main__":
    unittest.main()
