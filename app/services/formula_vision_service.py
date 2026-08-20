"""Vision-backed formula recognition with bounded provider fallback."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Protocol

from openai import AsyncOpenAI, APIStatusError, APITimeoutError, BadRequestError, RateLimitError

from app.config import config
from app.services.formula_conversion_service import (
    FormulaConversionError,
    choose_display_mode,
    sanitize_latex,
)
from app.services.image_processing import NormalizedImage
from app.services.formula_layout_service import detect_regions

logger = logging.getLogger(__name__)

VISION_SYSTEM_PROMPT = (
    "识别图片中的数学公式，只输出 JSON 且只能包含 latex 字段。"
    "latex 必须是裸公式，不含美元符号、解释、Markdown 或代码围栏。"
)
VISION_JSON_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "formula_recognition",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {"latex": {"type": "string", "minLength": 1, "maxLength": 2048}},
            "required": ["latex"],
            "additionalProperties": False,
        },
    },
}

CONTENT_SYSTEM_PROMPT = (
    "识别图片中的题目内容，按从上到下、从左到右输出题干文字和独立数学公式。"
    "只输出 JSON，格式为 {blocks:[{type:text,text:...}|{type:formula,latex:...}],warnings:[...]}。"
    "公式 latex 必须是裸公式，不含美元符号、解释或 Markdown；不要返回 display_mode。"
    "看不清、图形、表格或无法结构化的区域只放入 warnings，不要猜测或伪造。"
)
CONTENT_JSON_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "content_recognition",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "blocks": {"type": "array", "maxItems": 50, "items": {"type": "object"}},
                "warnings": {"type": "array", "maxItems": 10, "items": {"type": "string", "maxLength": 200}},
            },
            "required": ["blocks", "warnings"],
            "additionalProperties": False,
        },
    },
}


class FormulaVisionError(FormulaConversionError):
    def __init__(self, message: str, code: str = "provider_unavailable", status_code: int = 503):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class VisionProvider(Protocol):
    name: str

    async def recognize(self, image: NormalizedImage, timeout: float) -> str: ...

    async def recognize_content(self, image: NormalizedImage, timeout: float) -> str: ...


@dataclass
class OpenAIVisionProvider:
    name: str
    api_key: str
    base_url: str
    model: str
    thinking: str = "disabled"

    def _thinking_extra_body(self) -> dict:
        return {"thinking": {"type": self.thinking}} if self.thinking in {"enabled", "disabled"} else {}

    @property
    def emits_thinking(self) -> bool:
        return "thinking" in self.model.lower()

    async def recognize(self, image: NormalizedImage, timeout: float) -> str:
        client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url, timeout=timeout, max_retries=0)
        try:
            request = {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": VISION_SYSTEM_PROMPT},
                    {"role": "user", "content": [
                        {"type": "text", "text": "请准确转写图片中的公式。"},
                        {"type": "image_url", "image_url": {"url": image.data_url()}},
                    ]},
                ],
                "temperature": 0,
                "max_tokens": 2048 if self.emits_thinking else 512,
                "extra_body": self._thinking_extra_body(),
            }
            try:
                response = await client.chat.completions.create(**request, response_format=VISION_JSON_SCHEMA)
            except BadRequestError:
                response = await client.chat.completions.create(**request, response_format={"type": "json_object"})
            return response.choices[0].message.content or ""
        finally:
            await client.close()

    async def recognize_content(self, image: NormalizedImage, timeout: float) -> str:
        client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url, timeout=timeout, max_retries=0)
        request = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": CONTENT_SYSTEM_PROMPT},
                {"role": "user", "content": [{"type": "text", "text": "请转写整张题目图片。"}, {"type": "image_url", "image_url": {"url": image.data_url()}}]},
            ],
            "temperature": 0,
            # 智谱 GLM 视觉接口的 max_tokens 上限为 1024；超出会返回 1210。
            "max_tokens": 2048 if self.emits_thinking else 1024,
            "extra_body": self._thinking_extra_body(),
        }
        try:
            try:
                response = await client.chat.completions.create(**request, response_format=CONTENT_JSON_SCHEMA)
            except BadRequestError:
                response = await client.chat.completions.create(**request, response_format={"type": "json_object"})
            return response.choices[0].message.content or ""
        finally:
            await client.close()


def build_default_vision_providers() -> list[VisionProvider]:
    providers: list[VisionProvider] = []
    if config.FORMULA_VISION_API_KEY and config.FORMULA_VISION_API_BASE and config.FORMULA_VISION_MODEL:
        providers.append(OpenAIVisionProvider("glm_vision", config.FORMULA_VISION_API_KEY, config.FORMULA_VISION_API_BASE, config.FORMULA_VISION_MODEL, config.FORMULA_VISION_THINKING))
    return providers


def _classify_error(exc: Exception) -> FormulaVisionError:
    if isinstance(exc, asyncio.TimeoutError) or isinstance(exc, APITimeoutError):
        return FormulaVisionError("公式识别超时，请重试", "timeout", 504)
    if isinstance(exc, RateLimitError):
        return FormulaVisionError("公式识别服务当前限流，请稍后重试", "rate_limited", 503)
    if isinstance(exc, (BadRequestError, APIStatusError)):
        return FormulaVisionError("公式识别上游暂时不可用，请重试", "upstream_unavailable", 503)
    return FormulaVisionError("公式识别服务暂时不可用，请重试", "upstream_unavailable", 503)


class FormulaVisionService:
    def __init__(self, providers: list[VisionProvider] | None = None, total_timeout: float | None = None) -> None:
        self.providers = providers if providers is not None else build_default_vision_providers()
        self.total_timeout = total_timeout if total_timeout is not None else config.FORMULA_RECOGNIZE_TOTAL_TIMEOUT_SECONDS

    async def recognize(self, image: NormalizedImage) -> tuple[str, str]:
        if not self.providers:
            raise FormulaVisionError("公式识别尚未配置视觉 provider", "not_configured", 503)
        deadline = time.monotonic() + self.total_timeout
        last_error: FormulaVisionError | None = None
        for index, provider in enumerate(self.providers):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            configured_budget = config.FORMULA_VISION_TIMEOUT_SECONDS if index == 0 else config.FORMULA_FALLBACK_TIMEOUT_SECONDS
            budget = min(remaining, configured_budget)
            started = time.monotonic()
            status = "error"
            error_type = ""
            try:
                raw = await asyncio.wait_for(provider.recognize(image, budget), timeout=budget)
                try:
                    latex = _sanitize_vision_formula(raw)
                except FormulaConversionError as exc:
                    raise FormulaVisionError(str(exc), "invalid_model_output", 502) from exc
                status = "success"
                return latex, choose_display_mode(latex, "auto")
            except FormulaVisionError as exc:
                last_error = exc
                error_type = exc.code
            except Exception as exc:
                last_error = _classify_error(exc)
                error_type = last_error.code
            finally:
                logger.info("formula_recognize", extra={"provider": provider.name, "latency_ms": round((time.monotonic() - started) * 1000), "status": status, "error_type": error_type, "image_width": image.width, "image_height": image.height})
        if last_error and last_error.code == "timeout" and time.monotonic() >= deadline:
            raise FormulaVisionError("公式识别超时，请重试", "timeout", 504)
        raise last_error or FormulaVisionError("公式识别服务暂时不可用，请重试")


    async def recognize_content(self, image: NormalizedImage) -> tuple[list[dict[str, str]], list[str]]:
        if not self.providers:
            raise FormulaVisionError("内容识别尚未配置视觉 provider", "not_configured", 503)
        deadline = time.monotonic() + config.FORMULA_CONTENT_VISION_TIMEOUT_SECONDS
        last_error: FormulaVisionError | None = None
        for provider in self.providers:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            started = time.monotonic()
            status, error_type = "error", ""
            try:
                method = getattr(provider, "recognize_content", None)
                if method is None:
                    raise FormulaVisionError("视觉 provider 不支持混合内容识别", "upstream_unavailable", 503)
                regions = detect_regions(image.data)
                if getattr(provider, "emits_thinking", False):
                    regions = regions[:1]
                if len(regions) <= 1:
                    raw = await asyncio.wait_for(method(image, remaining), timeout=remaining)
                    blocks, warnings = _normalize_content_response(raw)
                else:
                    # Keep the whole-page path as a fallback, but give the model
                    # one logical line at a time for multi-formula photographs.
                    blocks, warnings = [], []
                    started_at = time.monotonic()
                    from PIL import Image
                    from io import BytesIO
                    with Image.open(BytesIO(image.data)) as source:
                        selected_regions = regions[:12]
                        for index, region in enumerate(selected_regions):
                            if time.monotonic() - started_at >= remaining:
                                raise FormulaVisionError("内容识别超时，请重试", "timeout", 504)
                            crop = source.crop(region.bbox)
                            output = BytesIO()
                            crop.save(output, format="PNG", optimize=True)
                            crop_image = NormalizedImage(output.getvalue(), "image/png", crop.width, crop.height, image.sha256)
                            regions_left = len(selected_regions) - index
                            budget = max(0.8, (remaining - (time.monotonic() - started_at)) / regions_left)
                            raw = await asyncio.wait_for(method(crop_image, budget), timeout=budget)
                            crop_blocks, crop_warnings = _normalize_content_response(raw)
                            for block in crop_blocks:
                                block["bbox"] = list(region.bbox)
                            blocks.extend(crop_blocks)
                            warnings.extend(crop_warnings)
                    blocks = _merge_segment_boundaries(blocks)
                    if any(block["type"] == "formula" for block in blocks):
                        warnings = [warning for warning in warnings if warning != "未检测到可确认公式"]
                status = "success"
                return blocks, warnings
            except FormulaVisionError as exc:
                last_error, error_type = exc, exc.code
            except Exception as exc:
                last_error = _classify_error(exc)
                error_type = last_error.code
            finally:
                logger.info("formula_content_recognize", extra={"provider": provider.name, "latency_ms": round((time.monotonic() - started) * 1000), "status": status, "error_type": error_type, "image_width": image.width, "image_height": image.height})
        if last_error and last_error.code == "timeout":
            raise FormulaVisionError("内容识别超时，请重试", "timeout", 504)
        raise last_error or FormulaVisionError("内容识别服务暂时不可用", "upstream_unavailable", 503)


_CONTENT_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_CONTENT_TAG = re.compile(r"<[^>]*>")
_CONTENT_LINK = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
_INVALID_JSON_ESCAPE = re.compile(r"(?<!\\)\\(?![\"\\/bfnrtu])")
_LATEX_JSON_COMMAND = re.compile(
    r"(?<!\\)\\(?=(?:left|right|frac|partial|sum|prod|int|lim|to|infty|Psi|psi|"
    r"alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|omega|"
    r"mathbf|mathrm|operatorname|begin|end)\b)"
)


def _extract_answer_payload(raw: str) -> str:
    """Keep only the final answer when a thinking model ignores the switch."""
    value = (raw or "").strip()
    answer = re.search(r"<answer>\s*(.*?)\s*</answer>", value, flags=re.IGNORECASE | re.DOTALL)
    if answer:
        return answer.group(1).strip()
    value = re.sub(r"<think>.*?</think>", "", value, flags=re.IGNORECASE | re.DOTALL)
    return value.strip()
_CONTENT_TEXT_TOTAL_LIMIT = 8000
_CONTENT_TEXT_BLOCK_LIMIT = 500
_CONTENT_FORMULA_TOTAL_LIMIT = 12000
_CONTENT_BLOCK_LIMIT = 50
_CONTENT_WARNING_LIMIT = 10
_FORMULA_FALLBACK_TEXT = "[此处公式未能结构化识别]"


def _repair_latex_transport_controls(value: str) -> str:
    """Restore LaTeX commands lost when a provider emits under-escaped JSON."""
    replacements = {
        "\x08": r"\b",
        "\x09": r"\t",
        "\x0a": r"\n",
        "\x0c": r"\f",
        "\x0d": r"\r",
    }
    return "".join(replacements.get(char, char) for char in value)


def _sanitize_vision_formula(raw: str) -> str:
    """Normalize a vision response before applying the shared safety checks."""
    value = _extract_answer_payload(raw)
    if len(value) >= 2 and value[0] == "'" and value[-1] == "'":
        value = value[1:-1].strip()
    value = _decode_transport_escapes(value)
    fenced = re.search(r"```(?:json|latex|tex)?\s*(\{.*?\})\s*```", value, flags=re.IGNORECASE | re.DOTALL)
    if fenced:
        value = fenced.group(1).strip()
    elif "{" in value and "}" in value:
        value = value[value.find("{") : value.rfind("}") + 1]
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        repaired = _INVALID_JSON_ESCAPE.sub(r"\\\\", value)
        try:
            parsed = json.loads(repaired)
        except json.JSONDecodeError:
            return sanitize_latex(raw)
    if isinstance(parsed, dict) and isinstance(parsed.get("latex"), str):
        parsed["latex"] = _repair_latex_transport_controls(parsed["latex"])
        return sanitize_latex(json.dumps(parsed, ensure_ascii=False))
    return sanitize_latex(raw)


def _decode_transport_escapes(value: str) -> str:
    """Decode literal control escapes outside JSON strings only."""
    chars: list[str] = []
    in_string = False
    escaped = False
    index = 0
    while index < len(value):
        char = value[index]
        if char == '"' and not escaped:
            in_string = not in_string
        if not in_string and char == "\\" and index + 1 < len(value):
            replacement = {"n": "\n", "r": "\r", "t": "\t"}.get(value[index + 1])
            if replacement is not None:
                chars.append(replacement)
                index += 2
                escaped = False
                continue
        chars.append(char)
        escaped = char == "\\" and not escaped
        if char != "\\":
            escaped = False
        index += 1
    return "".join(chars)


def _append_content_text(
    blocks: list[dict[str, str]], text: str, text_total: int
) -> int:
    """Append sanitized text without violating response block/total limits."""
    remaining_total = _CONTENT_TEXT_TOTAL_LIMIT - text_total
    pending = text[:remaining_total]
    while pending and len(blocks) < _CONTENT_BLOCK_LIMIT:
        if blocks and blocks[-1]["type"] == "text" and len(blocks[-1]["text"]) < _CONTENT_TEXT_BLOCK_LIMIT:
            capacity = _CONTENT_TEXT_BLOCK_LIMIT - len(blocks[-1]["text"])
            chunk, pending = pending[:capacity], pending[capacity:]
            blocks[-1]["text"] += chunk
        else:
            chunk, pending = pending[:_CONTENT_TEXT_BLOCK_LIMIT], pending[_CONTENT_TEXT_BLOCK_LIMIT:]
            blocks.append({"type": "text", "text": chunk})
        text_total += len(chunk)
    return text_total


def _normalize_content_response(raw: str) -> tuple[list[dict[str, str]], list[str]]:
    value = _extract_answer_payload(raw)
    # Some GLM responses return a quoted fenced payload containing literal
    # ``\\n`` separators. Strip only the outer quote, then decode separators
    # outside JSON strings so LaTeX backslashes remain untouched.
    if len(value) >= 2 and value[0] == "'" and value[-1] == "'":
        value = value[1:-1].strip()
    value = _decode_transport_escapes(value)
    # GLM occasionally wraps an otherwise valid JSON response in a fenced block
    # or adds a short preface. Extract the first complete JSON object while
    # keeping the strict schema validation below as the source of truth.
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", value, flags=re.IGNORECASE | re.DOTALL)
    if fenced:
        value = fenced.group(1).strip()
    else:
        start = value.find("{")
        end = value.rfind("}")
        if start >= 0 and end > start:
            value = value[start : end + 1]
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        # A few GLM responses emit LaTeX backslashes as single backslashes
        # inside JSON strings. Repair only escapes that JSON does not define.
        # Escape known LaTeX commands first. Some begin with JSON-valid escape
        # letters (\f, \r), so repairing only invalid JSON escapes is insufficient.
        repaired = _LATEX_JSON_COMMAND.sub(r"\\\\", value)
        repaired = _INVALID_JSON_ESCAPE.sub(r"\\\\", repaired)
        try:
            parsed = json.loads(repaired)
        except json.JSONDecodeError:
            raise FormulaVisionError("模型返回内容无法解析", "invalid_model_output", 502) from exc
    if not isinstance(parsed, dict) or set(parsed) - {"blocks", "warnings"}:
        raise FormulaVisionError("模型返回了不符合内容协议的内容", "invalid_model_output", 502)
    raw_blocks = parsed.get("blocks")
    if not isinstance(raw_blocks, list):
        raise FormulaVisionError("模型返回了不符合内容协议的内容", "invalid_model_output", 502)
    raw_warnings = parsed.get("warnings", [])
    if not isinstance(raw_warnings, list):
        raise FormulaVisionError("模型返回了不符合内容协议的内容", "invalid_model_output", 502)

    blocks: list[dict[str, str]] = []
    warnings: list[str] = []
    text_total = formula_total = 0
    for item in raw_blocks:
        if not isinstance(item, dict) or item.get("type") not in {"text", "formula"}:
            continue
        if item["type"] == "text":
            raw_text = item.get("text")
            if not isinstance(raw_text, str):
                continue
            text = _CONTENT_LINK.sub("", _CONTENT_TAG.sub("", _CONTENT_CONTROL.sub("", raw_text))).strip()
            if not text:
                continue
            if "\\" in text and re.search(r"\\(?:frac|partial|sum|int|left|right|Psi|begin)\b", text):
                try:
                    latex = sanitize_latex(_repair_latex_transport_controls(text))
                except FormulaConversionError:
                    pass
                else:
                    formula_total += len(latex)
                    blocks.append({"type": "formula", "latex": latex, "display_mode": choose_display_mode(latex, "auto")})
                    continue
            text_total = _append_content_text(blocks, text, text_total)
            continue

        raw_latex = item.get("latex")
        if not isinstance(raw_latex, str) or not raw_latex.strip():
            continue
        raw_latex = _repair_latex_transport_controls(raw_latex)
        try:
            latex = sanitize_latex(raw_latex)
        except FormulaConversionError:
            warnings.append("有一个公式未能安全结构化识别")
            text_total = _append_content_text(blocks, _FORMULA_FALLBACK_TEXT, text_total)
            continue
        if formula_total + len(latex) > _CONTENT_FORMULA_TOTAL_LIMIT:
            continue
        if len(blocks) >= _CONTENT_BLOCK_LIMIT:
            continue
        formula_total += len(latex)
        blocks.append({"type": "formula", "latex": latex, "display_mode": choose_display_mode(latex, "auto")})

    for warning in raw_warnings:
        if not isinstance(warning, str):
            continue
        clean = _CONTENT_CONTROL.sub("", warning).strip()[:200]
        if clean and len(warnings) < _CONTENT_WARNING_LIMIT:
            warnings.append(clean)
    if not blocks:
        raise FormulaVisionError("图片中没有可识别的文字或公式", "no_content", 422)
    if not any(block["type"] == "formula" for block in blocks) and "未检测到可确认公式" not in warnings:
        if len(warnings) >= _CONTENT_WARNING_LIMIT:
            warnings[-1] = "未检测到可确认公式"
        else:
            warnings.append("未检测到可确认公式")
    return blocks, warnings[:_CONTENT_WARNING_LIMIT]


def _merge_segment_boundaries(blocks: list[dict]) -> list[dict]:
    """Repair a common model split: ``J`` followed by formula ``_i = ...``."""
    merged: list[dict] = []
    for block in blocks:
        if (
            block.get("type") == "formula"
            and str(block.get("latex", "")).startswith(("_", "^"))
            and merged
            and merged[-1].get("type") == "text"
            and re.fullmatch(r"[A-Za-zΑ-Ωα-ω]", str(merged[-1].get("text", "")).strip())
            and merged[-1].get("bbox") == block.get("bbox")
        ):
            prefix = merged.pop()["text"].strip()
            block = {**block, "latex": prefix + block["latex"]}
        merged.append(block)
    return merged


formula_vision_service = FormulaVisionService()
