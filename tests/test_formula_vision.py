import asyncio
from io import BytesIO
import json
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from PIL import Image

from app.auth.jwt_handler import create_access_token
from app.main import app
from app.services.formula_vision_service import FormulaVisionError, FormulaVisionService, _merge_segment_boundaries, _sanitize_vision_formula
from app.services.image_processing import ImageProcessingError, NormalizedImage, normalize_image_bytes
from app.services.formula_layout_service import detect_regions


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
    def test_extracts_answer_and_drops_thinking(self) -> None:
        raw = '<think>猜测过程</think><answer>{"latex":"x^2"}</answer>'
        self.assertEqual(_sanitize_vision_formula(raw), 'x^2')

    def test_openai_provider_sends_disabled_thinking(self) -> None:
        from app.services.formula_vision_service import OpenAIVisionProvider
        self.assertEqual(OpenAIVisionProvider('x', 'k', 'u', 'm')._thinking_extra_body(), {'thinking': {'type': 'disabled'}})
        self.assertEqual(OpenAIVisionProvider('x', 'k', 'u', 'm', 'enabled')._thinking_extra_body(), {'thinking': {'type': 'enabled'}})
        self.assertTrue(OpenAIVisionProvider('x', 'k', 'u', 'glm-4.1v-thinking-flash').emits_thinking)
        self.assertFalse(OpenAIVisionProvider('x', 'k', 'u', 'glm-4v-flash').emits_thinking)

    def test_merges_variable_split_from_leading_subscript_formula(self) -> None:
        bbox = [0, 100, 300, 160]
        blocks = _merge_segment_boundaries([
            {'type': 'text', 'text': 'J', 'bbox': bbox},
            {'type': 'formula', 'latex': r'_i=\sum_j x_j', 'display_mode': 'inline', 'bbox': bbox},
        ])
        self.assertEqual(blocks, [{'type': 'formula', 'latex': r'J_i=\sum_j x_j', 'display_mode': 'inline', 'bbox': bbox}])

    def test_layout_detector_returns_ordered_regions_for_multiple_lines(self) -> None:
        output = BytesIO()
        image = Image.new('RGB', (320, 180), 'white')
        from PIL import ImageDraw
        draw = ImageDraw.Draw(image)
        draw.rectangle((30, 25, 290, 35), fill='black')
        draw.rectangle((70, 120, 260, 130), fill='black')
        image.save(output, format='PNG')
        regions = detect_regions(output.getvalue())
        self.assertGreaterEqual(len(regions), 2)
        self.assertLess(regions[0].bbox[1], regions[1].bbox[1])

    async def test_content_recognition_segments_multiple_lines_and_attaches_bbox(self) -> None:
        output = BytesIO()
        image = Image.new('RGB', (320, 180), 'white')
        from PIL import ImageDraw
        draw = ImageDraw.Draw(image)
        draw.rectangle((30, 25, 290, 35), fill='black')
        draw.rectangle((70, 120, 260, 130), fill='black')
        image.save(output, format='PNG')
        provider = FakeVisionProvider('vision', '{"blocks":[{"type":"formula","latex":"x^2"}],"warnings":[]}')
        service = FormulaVisionService([provider], total_timeout=2)
        blocks, warnings = await service.recognize_content(normalize_image_bytes(output.getvalue(), 'image/png'))
        self.assertGreaterEqual(provider.calls, 2)
        self.assertGreaterEqual(len(blocks), 2)
        self.assertTrue(all(block.get('bbox') for block in blocks))
        self.assertEqual(warnings, [])

    async def test_segment_budget_is_rebalanced_after_each_region(self) -> None:
        output = BytesIO()
        image = Image.new('RGB', (320, 180), 'white')
        from PIL import ImageDraw
        draw = ImageDraw.Draw(image)
        draw.rectangle((30, 25, 290, 35), fill='black')
        draw.rectangle((70, 120, 260, 130), fill='black')
        image.save(output, format='PNG')
        provider = FakeVisionProvider('vision', '{"blocks":[{"type":"formula","latex":"x"}],"warnings":[]}')
        service = FormulaVisionService([provider], total_timeout=2)
        with patch('app.services.formula_vision_service.config.FORMULA_CONTENT_VISION_TIMEOUT_SECONDS', 2):
            await service.recognize_content(normalize_image_bytes(output.getvalue(), 'image/png'))
        self.assertEqual(len(provider.timeouts), 2)
        self.assertGreater(provider.timeouts[1], provider.timeouts[0])

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

    async def test_content_promotes_latex_mislabeled_as_text(self) -> None:
        raw = r'{"blocks":[{"type":"text","text":"\left| \Psi \right> = \sum_{n=0}^{\infty} a_n \left| \Psi_n \right>"}],"warnings":[]}'
        blocks, warnings = await FormulaVisionService([FakeVisionProvider('vision', raw)], total_timeout=1).recognize_content(normalized_image())
        self.assertEqual(blocks[0]['type'], 'formula')
        self.assertIn(r'\sum', blocks[0]['latex'])
        self.assertEqual(warnings, [])

    async def test_single_formula_repairs_underescaped_json_commands(self) -> None:
        raw = r'{"latex":"\lim_{n\to\infty}(1+\frac{1}{n})^n=e"}'
        service = FormulaVisionService([FakeVisionProvider('vision', raw)], total_timeout=1)
        self.assertEqual(await service.recognize(normalized_image()), (r'\lim_{n\to\infty}(1+\frac{1}{n})^n=e', 'inline'))

    async def test_content_normalizes_mixed_blocks_and_infers_display_mode(self) -> None:
        raw = r'{"blocks":[{"type":"text","text":"  设 x > 0  "},{"type":"text","text":"求下式"},{"type":"formula","latex":"\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}","display_mode":"inline"}],"warnings":[]}'
        blocks, warnings = await FormulaVisionService([FakeVisionProvider('vision', raw)]).recognize_content(normalized_image())
        self.assertEqual(blocks[0], {'type': 'text', 'text': '设 x > 0求下式'})
        self.assertEqual(blocks[1]['display_mode'], 'block')
        self.assertEqual(warnings, [])

    async def test_content_drops_blank_keeps_duplicates_and_warns_without_formula(self) -> None:
        raw = '{"blocks":[{"type":"text","text":"   "},{"type":"text","text":"重复"},{"type":"formula","latex":"x"},{"type":"formula","latex":"x"}],"warnings":[]}'
        blocks, _ = await FormulaVisionService([FakeVisionProvider('vision', raw)]).recognize_content(normalized_image())
        self.assertEqual([block.get('latex') for block in blocks if block['type'] == 'formula'], ['x', 'x'])

        text_only = '{"blocks":[{"type":"text","text":"只有文字"}],"warnings":[]}'
        _, warnings = await FormulaVisionService([FakeVisionProvider('vision', text_only)]).recognize_content(normalized_image())
        self.assertIn('未检测到可确认公式', warnings)

    async def test_content_invalid_formula_uses_safe_placeholder(self) -> None:
        raw = r'{"blocks":[{"type":"formula","latex":"\\href{https://bad.example}{x}"}],"warnings":[]}'
        blocks, warnings = await FormulaVisionService([FakeVisionProvider('vision', raw)]).recognize_content(normalized_image())
        self.assertEqual(blocks, [{'type': 'text', 'text': '[此处公式未能结构化识别]'}])
        self.assertNotIn('href', str(blocks))
        self.assertTrue(any('安全结构化' in warning for warning in warnings))

    async def test_content_limits_text_formula_warnings_and_block_lengths(self) -> None:
        formula = 'x' * 2000
        payload = {
            'blocks': [
                {'type': 'text', 'text': '甲' * 5000},
                {'type': 'text', 'text': '乙' * 5000},
                *[{'type': 'formula', 'latex': formula} for _ in range(7)],
            ],
            'warnings': ['警' * 300 for _ in range(12)],
        }
        blocks, warnings = await FormulaVisionService([FakeVisionProvider('vision', json.dumps(payload, ensure_ascii=False))]).recognize_content(normalized_image())
        self.assertLessEqual(sum(len(block['text']) for block in blocks if block['type'] == 'text'), 8000)
        self.assertTrue(all(len(block['text']) <= 500 for block in blocks if block['type'] == 'text'))
        self.assertLessEqual(sum(len(block['latex']) for block in blocks if block['type'] == 'formula'), 12000)
        self.assertLessEqual(len(warnings), 10)
        self.assertTrue(all(len(warning) <= 200 for warning in warnings))

    async def test_content_rejects_empty_and_invalid_payloads(self) -> None:
        for raw, code in [
            ('not json', 'invalid_model_output'),
            ('{"blocks":[],"warnings":[]}', 'no_content'),
            ('{"blocks":[],"warnings":[],"extra":true}', 'invalid_model_output'),
        ]:
            with self.subTest(raw=raw), self.assertRaises(FormulaVisionError) as caught:
                await FormulaVisionService([FakeVisionProvider('vision', raw)]).recognize_content(normalized_image())
            self.assertEqual(caught.exception.code, code)

    async def test_content_timeout_has_stable_status(self) -> None:
        with patch('app.services.formula_vision_service.config.FORMULA_CONTENT_VISION_TIMEOUT_SECONDS', 0.01):
            with self.assertRaises(FormulaVisionError) as caught:
                await FormulaVisionService([FakeVisionProvider('vision', delay=0.05)]).recognize_content(normalized_image())
        self.assertEqual(caught.exception.code, 'timeout')
        self.assertEqual(caught.exception.status_code, 504)


class FormulaVisionRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        token = create_access_token({'user_id': 'formula-vision-test'})
        self.headers = {'Authorization': f'Bearer {token}'}

    def test_requires_authentication(self) -> None:
        response = self.client.post('/api/formula/recognize', files={'image': ('formula.png', png_bytes(), 'image/png')})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['detail'], '未登录或token无效')

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

    def test_content_route_requires_authentication(self) -> None:
        response = self.client.post('/api/formula/recognize-content', files={'image': ('photo.png', png_bytes(), 'image/png')})
        self.assertEqual(response.status_code, 401)

    def test_content_route_returns_mixed_blocks(self) -> None:
        result = ([{'type': 'text', 'text': '求解'}, {'type': 'formula', 'latex': 'x^2=1', 'display_mode': 'inline'}], [])
        with patch('app.routers.formula.formula_vision_service.recognize_content', new=AsyncMock(return_value=result)):
            response = self.client.post('/api/formula/recognize-content', headers=self.headers, files={'image': ('photo.png', png_bytes(), 'image/png')})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['blocks'], result[0])

    def test_content_route_preserves_processing_and_provider_errors(self) -> None:
        unsupported = self.client.post('/api/formula/recognize-content', headers=self.headers, files={'image': ('photo.gif', b'GIF89a', 'image/gif')})
        self.assertEqual(unsupported.status_code, 415)
        self.assertEqual(unsupported.json()['detail']['code'], 'unsupported_format')

        failure = FormulaVisionError('内容识别超时', 'timeout', 504)
        with patch('app.routers.formula.formula_vision_service.recognize_content', new=AsyncMock(side_effect=failure)):
            timed_out = self.client.post('/api/formula/recognize-content', headers=self.headers, files={'image': ('photo.png', png_bytes(), 'image/png')})
        self.assertEqual(timed_out.status_code, 504)
        self.assertEqual(timed_out.json()['detail']['code'], 'timeout')


if __name__ == '__main__':
    unittest.main()
