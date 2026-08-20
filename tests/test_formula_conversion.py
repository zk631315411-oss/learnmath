import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.auth.jwt_handler import create_access_token
from app.main import app
from app.services.formula_conversion_service import (
    FormulaConversionError,
    FormulaConversionService,
    SYSTEM_PROMPT,
    UnsafeFormulaError,
    choose_display_mode,
    sanitize_latex,
)


class FakeProvider:
    def __init__(self, name: str, result: str = "", error: Exception | None = None):
        self.name = name
        self.result = result
        self.error = error
        self.calls = 0

    async def convert(self, description: str, timeout: float) -> str:
        self.calls += 1
        if self.error:
            raise self.error
        return self.result


class FormulaSanitizerTests(unittest.TestCase):
    def test_extracts_json_and_delimiters(self) -> None:
        self.assertEqual(sanitize_latex('```json\n{"latex":"$x^2$"}\n```'), "x^2")

    def test_extracts_provider_json_with_unescaped_latex_commands(self) -> None:
        raw = "```json\n" + r'{"latex":"\int_{0}^{1} x^2 \, dx = \frac{1}{3}"}' + "\n```"
        self.assertEqual(
            sanitize_latex(raw),
            r"\int_{0}^{1} x^2 \, dx = \frac{1}{3}",
        )

    def test_relaxed_json_still_rejects_extra_fields(self) -> None:
        with self.assertRaises(UnsafeFormulaError):
            sanitize_latex(r'{"latex":"\frac{1}{2}","note":"extra"}')

    def test_repairs_doubled_environment_end_slash(self) -> None:
        self.assertEqual(
            sanitize_latex(r"\begin{pmatrix}a&b\\c&d\\end{pmatrix}"),
            r"\begin{pmatrix}a&b\\c&d\end{pmatrix}",
        )

    def test_rejects_non_math_content(self) -> None:
        for value in (
            r"\href{https://example.com}{x}",
            r"\input{secret}",
            "<b>x</b>",
            '{"latex":"x^2","explanation":"square x"}',
            "解释：x^2",
            "The formula is x^2",
        ):
            with self.subTest(value=value), self.assertRaises(UnsafeFormulaError):
                sanitize_latex(value)

    def test_keeps_chinese_conditions_inside_text(self) -> None:
        self.assertEqual(sanitize_latex(r"x\text{ 为偶数}"), r"x\text{ 为偶数}")

    def test_auto_display_uses_block_for_structures(self) -> None:
        self.assertEqual(
            choose_display_mode(r"\begin{pmatrix}a&b\\c&d\end{pmatrix}", "auto"),
            "block",
        )
        self.assertEqual(choose_display_mode(r"\frac{a}{b}", "auto"), "inline")
        self.assertEqual(choose_display_mode("x", "block"), "block")


class FormulaServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_provider_success_is_sanitized(self) -> None:
        provider = FakeProvider("formula", result='{"latex":"x^2"}')
        service = FormulaConversionService([provider], timeout_seconds=1)
        self.assertEqual(await service.convert("x平方"), ("x^2", "inline"))
        self.assertEqual(provider.calls, 1)

    async def test_total_timeout_is_enforced(self) -> None:
        class SlowProvider:
            name = "slow"

            async def convert(self, description: str, timeout: float) -> str:
                await asyncio.sleep(0.1)
                return "x"

        service = FormulaConversionService([SlowProvider()], timeout_seconds=0.01)
        with self.assertRaises(FormulaConversionError):
            await service.convert("x")

    async def test_primary_failure_uses_explicit_fallback(self) -> None:
        primary = FakeProvider("primary", error=RuntimeError("down"))
        fallback = FakeProvider("fallback", result='{"latex":"x+1"}')
        service = FormulaConversionService([primary, fallback], timeout_seconds=1)
        self.assertEqual(await service.convert("x加1"), ("x+1", "inline"))
        self.assertEqual((primary.calls, fallback.calls), (1, 1))

    async def test_primary_timeout_preserves_fallback_budget(self) -> None:
        class SlowProvider:
            name = "slow"

            async def convert(self, description: str, timeout: float) -> str:
                await asyncio.sleep(0.03)
                return "x"

        fallback = FakeProvider("fallback", result='{"latex":"y"}')
        with patch("app.services.formula_conversion_service.config.FORMULA_CONVERSION_TIMEOUT_SECONDS", 0.01), patch("app.services.formula_conversion_service.config.FORMULA_FALLBACK_TIMEOUT_SECONDS", 0.05):
            service = FormulaConversionService([SlowProvider(), fallback], timeout_seconds=0.1)
            self.assertEqual(await service.convert("y"), ("y", "inline"))
        self.assertEqual(fallback.calls, 1)

    def test_prompt_examples_are_valid_json(self) -> None:
        outputs = [
            line.removeprefix("输出：")
            for line in SYSTEM_PROMPT.splitlines()
            if line.startswith("输出：")
        ]
        self.assertEqual(
            [json.loads(output)["latex"] for output in outputs],
            [
                r"\lim_{x \to 0} \frac{\sin x}{x}",
                r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}",
                "x^2+y^2=1",
            ],
        )


class FormulaRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        token = create_access_token({"user_id": "formula-test-user"})
        self.headers = {"Authorization": f"Bearer {token}"}

    def test_requires_authentication(self) -> None:
        response = self.client.post("/api/formula/convert", json={"description": "x平方"})
        self.assertEqual(response.status_code, 401)

    def test_validates_description_boundary(self) -> None:
        for description in ("", "   ", "x" * 501):
            with self.subTest(description=description[:10]):
                response = self.client.post(
                    "/api/formula/convert",
                    json={"description": description},
                    headers=self.headers,
                )
                self.assertEqual(response.status_code, 422)

    def test_returns_conversion(self) -> None:
        with patch(
            "app.routers.formula.formula_conversion_service.convert",
            new=AsyncMock(return_value=(r"\lim_{x \to 0}\frac{\sin x}{x}", "inline")),
        ):
            response = self.client.post(
                "/api/formula/convert",
                json={
                    "description": "x趋于0时sin x除以x的极限",
                    "preferred_display": "auto",
                },
                headers=self.headers,
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["display_mode"], "inline")

    def test_service_failure_returns_503(self) -> None:
        with patch(
            "app.routers.formula.formula_conversion_service.convert",
            new=AsyncMock(side_effect=FormulaConversionError("unavailable")),
        ):
            response = self.client.post(
                "/api/formula/convert",
                json={"description": "x平方"},
                headers=self.headers,
            )
        self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
