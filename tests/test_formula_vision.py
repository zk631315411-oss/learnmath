import asyncio
from io import BytesIO
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from PIL import Image

from app.auth.jwt_handler import create_access_token
from app.main import app
from app.services.formula_vision_service import FormulaVisionError, FormulaVisionService
from app.services.image_processing import ImageProcessingError, NormalizedImage


class FakeVisionProvider:
    def __init__(self, name: str, result: str = '', error: Exception | None = None, delay: float = 0):
        self.name = name
        self.result = result
        self.error = error
        self.delay = delay
        self.calls = 0
        self.timeouts: list[float] = []

    async def recognize(self, image: NormalizedImage, timeout: float) -> str:
        self.calls += 1
        self.timeouts.append(timeout)
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        return self.result

    async def recognize_content(self, image: NormalizedImage, timeout: float) -> str:
        return await self.recognize(image, timeout)


def normalized_image() -> NormalizedImage:
    return NormalizedImage(b'png', 'image/png', 120, 40, 'sha')


def png_bytes(width: int = 40, height: int = 20) -> bytes:
    output = BytesIO()
    Image.new('RGB', (width, height), 'white').save(output, format='PNG')
    return output.getvalue()


class FormulaVisionServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_success_sanitizes_json(self) -> None:
        service = FormulaVisionService([FakeVisionProvider('vision', '{"latex":"$x^2$"}')], total_timeout=1)
        self.assertEqual(await service.recognize(normalized_image()), ('x^2', 'inline'))

    async def test_not_configured_has_stable_code(self) -> None:
        with self.assertRaises(FormulaVisionError) as caught:
            await FormulaVisionService([], total_timeout=1).recognize(normalized_image())
        self.assertEqual(caught.exception.code, 'not_configured')
        self.assertEqual(caught.exception.status_code, 503)

    async def test_invalid_output_falls_back(self) -> None:
        primary = FakeVisionProvider('primary', '{"latex":"解释：x"}')
        fallback = FakeVisionProvider('fallback', '{"latex":"x"}')
        result = await FormulaVisionService([primary, fallback], total_timeout=1).recognize(normalized_image())
        self.assertEqual(result, ('x', 'inline'))
        self.assertEqual((primary.calls, fallback.calls), (1, 1))

    async def test_primary_timeout_leaves_fallback_budget(self) -> None:
        primary = FakeVisionProvider('primary', delay=0.03)
        fallback = FakeVisionProvider('fallback', result='{"latex":"y"}')
        with patch('app.services.formula_vision_service.config.FORMULA_VISION_TIMEOUT_SECONDS', 0.01), patch('app.services.formula_vision_service.config.FORMULA_FALLBACK_TIMEOUT_SECONDS', 0.05):
            result = await FormulaVisionService([primary, fallback], total_timeout=0.1).recognize(normalized_image())
        self.assertEqual(result, ('y', 'inline'))
        self.assertEqual(fallback.calls, 1)

    async def test_all_invalid_outputs_return_502(self) -> None:
        service = FormulaVisionService([FakeVisionProvider('vision', 'not json 公式')], total_timeout=1)
        with self.assertRaises(FormulaVisionError) as caught:
            await service.recognize(normalized_image())
        self.assertEqual(caught.exception.code, 'invalid_model_output')
        self.assertEqual(caught.exception.status_code, 502)

    async def test_content_json_fence_and_preface_are_accepted(self) -> None:
        raw = '识别结果如下：\\n```json\\n{"blocks":[{"type":"formula","latex":"$x^2$"}],"warnings":[]}\\n```\\n'
        service = FormulaVisionService([FakeVisionProvider('vision', raw)], total_timeout=1)
        blocks, warnings = await service.recognize_content(normalized_image())
        self.assertEqual(blocks, [{'type': 'formula', 'latex': 'x^2', 'display_mode': 'inline'}])
        self.assertEqual(warnings, [])

    async def test_content_quoted_fence_from_glm_is_accepted(self) -> None:
        raw = "'```json\\n{\"blocks\":[{\"type\":\"formula\",\"latex\":\"$x_i$\"}],\"warnings\":[]}\\n```'"
        service = FormulaVisionService([FakeVisionProvider('vision', raw)], total_timeout=1)
        blocks, warnings = await service.recognize_content(normalized_image())
        self.assertEqual(blocks, [{'type': 'formula', 'latex': 'x_i', 'display_mode': 'inline'}])
        self.assertEqual(warnings, [])

    async def test_content_repairs_underescaped_latex_json_commands(self) -> None:
        raw = r'{"blocks":[{"type":"formula","latex":"\lim_{n\to\infty}(1+\frac{1}{n})^n=e"}],"warnings":[]}'
        service = FormulaVisionService([FakeVisionProvider('vision', raw)], total_timeout=1)
        blocks, warnings = await service.recognize_content(normalized_image())
        self.assertEqual(
            blocks,
            [{'type': 'formula', 'latex': r'\lim_{n\to\infty}(1+\frac{1}{n})^n=e', 'display_mode': 'inline'}],
        )
        self.assertEqual(warnings, [])

    async def test_single_formula_repairs_underescaped_json_commands(self) -> None:
        raw = r'{"latex":"\lim_{n\to\infty}(1+\frac{1}{n})^n=e"}'
        service = FormulaVisionService([FakeVisionProvider('vision', raw)], total_timeout=1)
        self.assertEqual(await service.recognize(normalized_image()), (r'\lim_{n\to\infty}(1+\frac{1}{n})^n=e', 'inline'))


class FormulaVisionRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        token = create_access_token({'user_id': 'formula-vision-test'})
        self.headers = {'Authorization': f'Bearer {token}'}

    def test_requires_authentication(self) -> None:
        response = self.client.post('/api/formula/recognize', files={'image': ('formula.png', png_bytes(), 'image/png')})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['detail']['code'], 'unauthorized')

    def test_rejects_unsupported_media_type(self) -> None:
        response = self.client.post('/api/formula/recognize', headers=self.headers, files={'image': ('formula.gif', b'GIF89a', 'image/gif')})
        self.assertEqual(response.status_code, 415)
        self.assertEqual(response.json()['detail']['code'], 'unsupported_format')

    def test_rejects_invalid_image_content(self) -> None:
        response = self.client.post('/api/formula/recognize', headers=self.headers, files={'image': ('formula.png', b'not-an-image', 'image/png')})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['detail']['code'], 'invalid_image')

    def test_rejects_oversized_image_with_413(self) -> None:
        with patch('app.routers.formula.normalize_image_bytes', side_effect=ImageProcessingError('图片文件超过 15 MiB 上传限制', 413)):
            response = self.client.post('/api/formula/recognize', headers=self.headers, files={'image': ('formula.png', png_bytes(), 'image/png')})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()['detail']['code'], 'image_too_large')

    def test_returns_recognized_formula(self) -> None:
        with patch('app.routers.formula.formula_vision_service.recognize', new=AsyncMock(return_value=(r'\frac{a}{b}', 'inline'))):
            response = self.client.post('/api/formula/recognize', headers=self.headers, files={'image': ('formula.png', png_bytes(), 'image/png')})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'latex': r'\frac{a}{b}', 'display_mode': 'inline'})

    def test_service_error_preserves_status_and_code(self) -> None:
        failure = FormulaVisionError('识别超时', 'timeout', 504)
        with patch('app.routers.formula.formula_vision_service.recognize', new=AsyncMock(side_effect=failure)):
            response = self.client.post('/api/formula/recognize', headers=self.headers, files={'image': ('formula.png', png_bytes(), 'image/png')})
        self.assertEqual(response.status_code, 504)
        self.assertEqual(response.json()['detail'], {'code': 'timeout', 'message': '识别超时'})


if __name__ == '__main__':
    unittest.main()
