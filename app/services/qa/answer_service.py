"""QA 回答编排入口 — 阶段 1 精简版。

按输入类型分发：文字走 stream_chat，截图走 vision_chat；
事件形状（stage/content/done）与 ai-math 保持一致。
"""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import AsyncIterator

from fastapi.concurrency import run_in_threadpool

from app.services.llm_service import llm_service
from app.services.qa.contracts import QATurnInput
from app.services.qa.prompt_builder import build_qa_prompt
from app.services.qa.streaming_service import sse_done, sse_error, sse_stage, sse_text
from app.services.qa.vision_context_service import (
    prepare_screenshot_context,
    update_vision_summary,
)


async def answer_turn(turn_input: QATurnInput) -> AsyncIterator[dict]:
    """统一 QA 入口：文本与视觉两条路径对外暴露完全一致的 SSE 事件流。"""
    if turn_input.input_type == "text":
        async for event in _answer_text_turn(turn_input):
            yield event
        return
    async for event in _answer_vision_turn(turn_input):
        yield event


async def _answer_text_turn(turn_input: QATurnInput) -> AsyncIterator[dict]:
    if not turn_input.question:
        yield sse_error("未能识别题目内容")
        return

    turn_id = turn_input.chat_id or str(uuid.uuid4())
    started_at = time.perf_counter()
    full_response = ""

    try:
        yield sse_stage("searching", "正在匹配教材与知识图谱...")
        yield sse_stage("planning", "正在组织本轮讲解策略...")
        prompt = build_qa_prompt(
            turn_input.question,
            history=turn_input.history,
            teaching_mode=turn_input.teaching_mode,
            socratic_submode=turn_input.socratic_submode,
        )
        messages = [{"role": "user", "content": prompt}]

        if not llm_service.is_qa_available():
            yield sse_error("QA LLM 服务未配置：请在 .env 中设置 QA_LLM_API_KEY")
            return

        yield sse_stage("generating", "正在生成回答...")
        stream = llm_service.stream_chat(messages, enable_thinking=False)

        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if not delta or not delta.content:
                continue
            token = delta.content
            full_response += token
            yield sse_text(token)

        latency_ms = int((time.perf_counter() - started_at) * 1000)
        yield sse_done(
            full_text=full_response,
            thinking="",
            sources=[],
            sequence_id=None,
            qa_turn_id=turn_id,
            latency_ms=latency_ms,
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        yield sse_error(f"回答生成失败：{exc}")


async def _answer_vision_turn(turn_input: QATurnInput) -> AsyncIterator[dict]:
    if not turn_input.image_data:
        yield sse_error("未获取到截图图片，请重新上传后再试")
        return

    turn_id = turn_input.chat_id or str(uuid.uuid4())
    started_at = time.perf_counter()
    full_answer = ""

    try:
        yield sse_stage("reading_image", "正在读取截图...")
        screenshot_context = await run_in_threadpool(prepare_screenshot_context, turn_input)

        yield sse_stage("locating", "正在结合图片理解题目...")
        screenshot_note = (
            "你现在是在看图回答问题。请先仔细观察随附截图中的题目内容，"
            "再结合学生问题给出讲解。数学公式必须用 LaTeX 格式。"
        )
        prompt = build_qa_prompt(
            turn_input.question or "请分析这道题",
            history=turn_input.history,
            teaching_mode=turn_input.teaching_mode,
            socratic_submode=turn_input.socratic_submode,
            screenshot_note=screenshot_note,
        )

        if not llm_service.is_qa_available():
            yield sse_error("QA LLM 服务未配置：请在 .env 中设置 QA_LLM_API_KEY")
            return

        yield sse_stage("generating", "正在生成回答...")
        response = llm_service.vision_chat(turn_input.image_data, prompt, stream=True)

        for chunk in response:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if not delta:
                continue
            content = getattr(delta, "content", "")
            for token in _iter_text(content):
                full_answer += token
                yield sse_text(token)

        cache_id = screenshot_context.get("cache_id")
        if cache_id and full_answer:
            await run_in_threadpool(update_vision_summary, cache_id, full_answer[:4000])

        latency_ms = int((time.perf_counter() - started_at) * 1000)
        yield sse_done(
            full_text=full_answer,
            thinking="",
            sources=[],
            sequence_id=None,
            screenshot_context_id=cache_id,
            qa_turn_id=turn_id,
            latency_ms=latency_ms,
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        yield sse_error(f"截图回答生成失败：{exc}")


def _iter_text(content) -> list[str]:
    """兼容 VL 流式返回的两种形状：纯字符串或分段内容列表。"""
    if isinstance(content, list):
        return [
            item["text"]
            for item in content
            if isinstance(item, dict) and item.get("text")
        ]
    if content:
        return [str(content)]
    return []
