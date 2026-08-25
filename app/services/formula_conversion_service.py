"""Convert Chinese descriptions to safe, bare LaTeX."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Literal, Protocol

from openai import AsyncOpenAI, BadRequestError

from app.config import config

logger = logging.getLogger(__name__)

DisplayPreference = Literal["auto", "inline", "block"]
DisplayMode = Literal["inline", "block"]


def _formula_example(description: str, latex: str) -> str:
    payload = json.dumps({"latex": latex}, ensure_ascii=False, separators=(",", ":"))
    return f"输入：{description}\n输出：{payload}"


SYSTEM_PROMPT = "\n".join(
    (
        "你是数学公式转写器。把用户的中文描述转换成等价 LaTeX。",
        "只转写，不求值、不化简、不证明、不解释。输出 JSON，且只能包含 latex 字段。",
        "latex 必须是裸公式，不含 $、$$、\\(、\\)、代码围栏或 Markdown。",
        "禁止 HTML、链接、文件命令、自定义宏和文档命令。",
        # A/B 实验验证（2026-08-24，8/8 vs 5/8）：以下两条修复实测高频坑——
        "注意中文语序的运算优先级：描述中后说的运算往往作用于前面整个表达式。",
        "  如“x平方加1开根号”是 \\sqrt{x^2+1}（整体开根号），不是 x^2+\\sqrt{1}。",
        "保留描述里出现的每一个数学符号（π、α、β、e、θ 等），一个都不能丢。",
        "  如“派r平方”是 \\pi r^2，π 不能省略。",
        "示例：",
        _formula_example(
            "x趋于0时sin x除以x的极限",
            r"\lim_{x \to 0} \frac{\sin x}{x}",
        ),
        _formula_example(
            "二乘二矩阵，第一行a b，第二行c d",
            r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}",
        ),
        _formula_example("x平方加y平方等于1", "x^2+y^2=1"),
        # 给"正态分布"这类有标准记号的常见概念一个锚点，避免模型塞中文或瞎编。
        _formula_example(
            "标准正态分布的概率密度函数",
            r"\frac{1}{\sqrt{2\pi}} e^{-\frac{x^2}{2}}",
        ),
    )
)

FORMULA_JSON_SCHEMA_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "formula",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "latex": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 2048,
                    "pattern": r"^[^\u0000-\u001f\u007f]*$",
                }
            },
            "required": ["latex"],
            "additionalProperties": False,
        },
    },
}
FORMULA_JSON_OBJECT_FORMAT = {"type": "json_object"}


def build_formula_completion_request(description: str) -> dict[str, object]:
    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": description},
        ],
        "temperature": 0,
        "max_tokens": 128,
    }


_FORBIDDEN = re.compile(
    r"<[^>]+>|https?://|www\.|\\(?:href|url|include|input|write|openout|read|"
    r"newcommand|renewcommand|def|gdef|edef|xdef|usepackage|documentclass|"
    r"htmlClass|htmlId|htmlStyle)\b|\\(?:begin|end)\s*\{document\}",
    re.IGNORECASE,
)
_EXPLANATION_PREFIX = re.compile(
    r"(?:^|\s)(?:the\s+formula|the\s+answer|answer\s*:|result\s*:|"
    r"latex\s*:|here\s+is|therefore)\b|(?:解释|答案|结果|公式)\s*(?:是|为|:|：)",
    re.IGNORECASE,
)
_CJK_OUTSIDE_TEXT = re.compile(r"[\u3400-\u9fff]")
_CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")
_RELAXED_LATEX_OBJECT = re.compile(
    r'^\{\s*"latex"\s*:\s*"(?P<latex>(?:\\[^\r\n]|[^"\\\x00-\x1f\x7f])*)"\s*\}$'
)
_JSON_LIKE_OBJECT = re.compile(r'^\{.*"\s*:\s*".*\}$', re.DOTALL)
_BLOCK_STRUCTURE = re.compile(
    r"\\begin\s*\{(?:matrix|[bBpvV]matrix|cases|aligned|align(?:ed)?|gather(?:ed)?|split)\}"
    r"|\\\\"
)
_MALFORMED_ENV_END = re.compile(
    r"(?<!\\)\\\\end(\s*\{(?:matrix|[bBpvV]matrix|cases|aligned|align(?:ed)?|gather(?:ed)?|split)\})"
)
_ROW_ENVIRONMENT_TOKEN = re.compile(
    r"\\(?P<kind>begin|end)\s*\{(?P<name>matrix|[bBpvV]matrix|cases|aligned|align(?:ed)?|gather(?:ed)?|split)\}"
)
# A row break is also two backslashes. Normalize doubled commands outside
# row-oriented environments, while preserving compact forms such as ``\\c``.
_DOUBLE_BACKSLASH_COMMAND = re.compile(r"\\\\(?=[a-zA-Z])")


class FormulaConversionError(RuntimeError):
    pass


class UnsafeFormulaError(FormulaConversionError):
    pass


def _normalize_double_backslash_commands(value: str) -> str:
    protected_ranges: list[tuple[int, int]] = []
    open_environments: list[tuple[str, int]] = []

    for token in _ROW_ENVIRONMENT_TOKEN.finditer(value):
        kind = token.group("kind")
        name = token.group("name")
        if kind == "begin":
            open_environments.append((name, token.end()))
        elif open_environments and open_environments[-1][0] == name:
            _, body_start = open_environments.pop()
            protected_ranges.append((body_start, token.start()))

    if not protected_ranges:
        return _DOUBLE_BACKSLASH_COMMAND.sub(lambda _match: "\\", value)

    protected_ranges.sort()
    normalized: list[str] = []
    cursor = 0
    for start, end in protected_ranges:
        if start < cursor:
            continue
        normalized.append(_DOUBLE_BACKSLASH_COMMAND.sub(lambda _match: "\\", value[cursor:start]))
        normalized.append(value[start:end])
        cursor = end
    normalized.append(_DOUBLE_BACKSLASH_COMMAND.sub(lambda _match: "\\", value[cursor:]))
    return "".join(normalized)


class FormulaProvider(Protocol):
    name: str

    async def convert(self, description: str, timeout: float) -> str: ...


@dataclass
class OpenAIFormulaProvider:
    name: str
    api_key: str
    base_url: str
    model: str

    async def convert(self, description: str, timeout: float) -> str:
        client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=timeout,
            max_retries=0,
        )
        try:
            request = {"model": self.model, **build_formula_completion_request(description)}
            try:
                response = await client.chat.completions.create(
                    **request, response_format=FORMULA_JSON_SCHEMA_FORMAT
                )
            except BadRequestError:
                response = await client.chat.completions.create(
                    **request, response_format=FORMULA_JSON_OBJECT_FORMAT
                )
            return response.choices[0].message.content or ""
        finally:
            await client.close()


def build_default_providers() -> list[FormulaProvider]:
    providers: list[FormulaProvider] = []
    if config.FORMULA_API_BASE and config.FORMULA_API_KEY and config.FORMULA_MODEL:
        providers.append(OpenAIFormulaProvider(
            "formula_model",
            config.FORMULA_API_KEY,
            config.FORMULA_API_BASE,
            config.FORMULA_MODEL,
        ))
    if config.FORMULA_FALLBACK_API_BASE and config.FORMULA_FALLBACK_API_KEY and config.FORMULA_FALLBACK_MODEL:
        providers.append(OpenAIFormulaProvider(
            "formula_fallback",
            config.FORMULA_FALLBACK_API_KEY,
            config.FORMULA_FALLBACK_API_BASE,
            config.FORMULA_FALLBACK_MODEL,
        ))
    return providers


def sanitize_latex(raw: str) -> str:
    value = raw.strip(" \r\n")
    if value.startswith("```"):
        value = re.sub(r"^```(?:json|latex|tex)?\s*", "", value, flags=re.IGNORECASE)
        value = re.sub(r"\s*```$", "", value).strip()

    try:
        parsed = json.loads(value)
        if isinstance(parsed, dict):
            if set(parsed) != {"latex"} or not isinstance(parsed.get("latex"), str):
                raise UnsafeFormulaError("模型返回了不符合公式协议的内容")
            value = str(parsed["latex"])
            if _CONTROL_CHARACTERS.search(value):
                raise UnsafeFormulaError("模型返回了包含控制字符的公式")
            value = value.strip(" \r\n")
        elif isinstance(parsed, str):
            raise UnsafeFormulaError("模型返回了不符合公式协议的内容")
    except json.JSONDecodeError:
        # Some OpenAI-compatible vision providers emit a fenced JSON object but
        # leave LaTeX backslashes unescaped (for example, {"latex":"\frac..."}).
        # Accept only the exact one-field shape; all extracted text still passes
        # through the same control-character and command safety checks below.
        relaxed = _RELAXED_LATEX_OBJECT.fullmatch(value)
        if relaxed:
            value = relaxed.group("latex").strip(" \r\n")
        elif _JSON_LIKE_OBJECT.fullmatch(value):
            raise UnsafeFormulaError("模型返回了不符合公式协议的内容")

    delimiter_pairs = (("$$", "$$"), ("\\[", "\\]"), ("\\(", "\\)"), ("$", "$"))
    for start, end in delimiter_pairs:
        if value.startswith(start) and value.endswith(end) and len(value) >= len(start) + len(end):
            value = value[len(start):-len(end)].strip()
            break

    value = _MALFORMED_ENV_END.sub(r"\\end\1", value)
    # JSON transport can leave doubled backslashes in commands such as \\lim.
    value = _normalize_double_backslash_commands(value)

    if not value:
        raise FormulaConversionError("模型没有返回公式")
    if len(value) > 2048:
        raise FormulaConversionError("公式输出过长")
    if _CONTROL_CHARACTERS.search(value) or _FORBIDDEN.search(value):
        raise UnsafeFormulaError("模型返回了不安全的非数学内容")
    text_groups_removed = re.sub(r"\\text\{[^{}]*\}", "", value)
    if _EXPLANATION_PREFIX.search(value) or _CJK_OUTSIDE_TEXT.search(text_groups_removed):
        raise UnsafeFormulaError("模型返回了公式外的解释文字")
    if value.count("{") != value.count("}"):
        raise FormulaConversionError("公式括号不平衡")
    return value


def choose_display_mode(latex: str, preferred: DisplayPreference) -> DisplayMode:
    if preferred != "auto":
        return preferred
    return "block" if _BLOCK_STRUCTURE.search(latex) else "inline"


class FormulaConversionService:
    def __init__(
        self,
        providers: list[FormulaProvider] | None = None,
        timeout_seconds: float | None = None,
    ) -> None:
        self.providers = providers if providers is not None else build_default_providers()
        self.timeout_seconds = timeout_seconds or config.FORMULA_CONVERSION_TOTAL_TIMEOUT_SECONDS

    async def convert(
        self,
        description: str,
        preferred_display: DisplayPreference = "auto",
    ) -> tuple[str, DisplayMode]:
        if not self.providers:
            raise FormulaConversionError("没有可用的公式转换提供方")

        deadline = time.monotonic() + self.timeout_seconds
        for index, provider in enumerate(self.providers):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            provider_budget = config.FORMULA_CONVERSION_TIMEOUT_SECONDS if index == 0 else config.FORMULA_FALLBACK_TIMEOUT_SECONDS
            budget = min(remaining, provider_budget)
            started = time.monotonic()
            status = "error"
            error_type = ""
            try:
                raw = await asyncio.wait_for(
                    provider.convert(description, budget), timeout=budget
                )
                latex = sanitize_latex(raw)
                status = "success"
                return latex, choose_display_mode(latex, preferred_display)
            except Exception as exc:
                error_type = type(exc).__name__
            finally:
                logger.info(
                    "formula_conversion",
                    extra={
                        "provider": provider.name,
                        "latency_ms": round((time.monotonic() - started) * 1000),
                        "status": status,
                        "error_type": error_type,
                    },
                )
        raise FormulaConversionError("公式转换服务暂时不可用")


formula_conversion_service = FormulaConversionService()
