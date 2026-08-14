"""QA 回答编排入口 — 统一多模态版。

所有问答都走同一个多模态接口，没有图片时把图片部分省略即可。
kimi-k2.7-code 本身就是多模态模型，文字问题也能正常回答。
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
    """统一 QA 入口：所有问答都走多模态。"""
    if not turn_input.question and not turn_input.image_data:
        yield sse_error("请输入问题或上传截图")
        return

    turn_id = turn_input.chat_id or str(uuid.uuid4())
    started_at = time.perf_counter()
    full_answer = ""

    try:
        # ---- stage: 准备截图上下文（有图片时） ----
        screenshot_context = {}
        if turn_input.image_data:
            yield sse_stage("reading_image", "正在读取截图...")
            screenshot_context = await run_in_threadpool(prepare_screenshot_context, turn_input)

        # ---- 构建 prompt ----
        question = turn_input.question or "请分析这道题"
        screenshot_note = ""
        if turn_input.image_data:
            screenshot_note = (
                "你现在是在看图回答问题。请先仔细观察随附截图中的题目内容，"
                "再结合学生问题给出讲解。数学公式必须用 LaTeX 格式。"
            )
        prompt = build_qa_prompt(
            question,
            history=turn_input.history,
            teaching_mode=turn_input.teaching_mode,
            socratic_submode=turn_input.socratic_submode,
            screenshot_note=screenshot_note or None,
        )

        # ---- 构建多模态消息 ----
        user_content: list[dict] = []
        if turn_input.image_data:
            # 截图：图片 + 文字
            user_content.append({"type": "image_url", "image_url": {"url": turn_input.image_data}})
        user_content.append({"type": "text", "text": prompt})
        messages = [{"role": "user", "content": user_content}]

        # ---- 调用 LLM ----
        if not llm_service.is_available():
            yield sse_error("LLM 服务未配置：请在 .env 中设置 QA_LLM_API_KEY")
            return

        yield sse_stage("generating", "正在生成回答...")
        response = llm_service.chat(messages, stream=True, temperature=0.7)

        for chunk in response:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if not delta:
                continue
            content = getattr(delta, "content", None) or ""
            if not content:
                continue
            full_answer += content
            yield sse_text(content)

        # ---- 更新截图缓存（有图片时） ----
        cache_id = screenshot_context.get("cache_id")
        if cache_id and full_answer:
            await run_in_threadpool(update_vision_summary, cache_id, full_answer[:4000])

        latency_ms = int((time.perf_counter() - started_at) * 1000)
        yield sse_done(
            full_text=full_answer,
            thinking="",
            sources=[],
            sequence_id=None,
            screenshot_context_id=cache_id or None,
            qa_turn_id=turn_id,
            latency_ms=latency_ms,
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        yield sse_error(f"回答生成失败：{exc}")
