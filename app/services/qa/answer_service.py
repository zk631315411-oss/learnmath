"""QA 回答编排入口 — Agent 架构版（阶段 1）。

两条路径：
- answer_turn(): 直接流式回答（无工具调用，截图场景兜底）
- answer_turn_with_tools(): Agent 工具循环，LLM 自主决定是否调用 KG 查询

工具调用流程：
  1. 构建 system prompt（角色 + KG 上下文注入）
  2. 构建 user message（文字 + 可选截图）
  3. ToolRuntime.run() 驱动 LLM ↔ 工具循环
  4. 每个 tool_call / tool_result / final 都作为 SSE 事件流式输出
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
    """直接流式回答（无工具调用）。截图场景或工具不可用时的兜底。"""
    if not turn_input.question and not turn_input.image_data:
        yield sse_error("请输入问题或上传截图")
        return

    turn_id = turn_input.chat_id or str(uuid.uuid4())
    started_at = time.perf_counter()
    full_answer = ""

    try:
        screenshot_context = {}
        if turn_input.image_data:
            yield sse_stage("reading_image", "正在读取截图...")
            screenshot_context = await run_in_threadpool(prepare_screenshot_context, turn_input)

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

        user_content: list[dict] = []
        if turn_input.image_data:
            user_content.append({"type": "image_url", "image_url": {"url": turn_input.image_data}})
        user_content.append({"type": "text", "text": prompt})
        messages = [{"role": "user", "content": user_content}]

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
            content = getattr(delta, "content", None) or getattr(delta, "reasoning_content", None) or ""
            if not content:
                continue
            full_answer += content
            yield sse_text(content)

        cache_id = screenshot_context.get("cache_id")
        if cache_id and full_answer:
            await run_in_threadpool(update_vision_summary, cache_id, full_answer[:4000])

        latency_ms = int((time.perf_counter() - started_at) * 1000)
        yield sse_done(
            full_text=full_answer, thinking="", sources=[],
            screenshot_context_id=cache_id or None,
            qa_turn_id=turn_id, latency_ms=latency_ms,
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        yield sse_error(f"回答生成失败：{exc}")


async def answer_turn_with_tools(turn_input: QATurnInput) -> AsyncIterator[dict]:
    """Agent 工具循环：LLM 自主决定是否调用 KG 查询等工具。"""
    if not turn_input.question and not turn_input.image_data:
        yield sse_error("请输入问题或上传截图")
        return

    turn_id = turn_input.chat_id or str(uuid.uuid4())
    started_at = time.perf_counter()

    try:
        # ---- 截图上下文 ----
        screenshot_context = {}
        if turn_input.image_data:
            yield sse_stage("reading_image", "正在读取截图...")
            screenshot_context = await run_in_threadpool(prepare_screenshot_context, turn_input)

        # ---- 构建初始 prompt ----
        question = turn_input.question or "请分析这道题"
        screenshot_note = ""
        if turn_input.image_data:
            screenshot_note = (
                "你现在是在看图回答问题。请先仔细观察随附截图中的题目内容，"
                "再结合学生问题给出讲解。数学公式必须用 LaTeX 格式。"
            )

        # KG 提示：告诉 LLM 有 lookup_kg_node 工具可用
        kg_hint = (
            "\n\n你可以调用 lookup_kg_node 工具查询知识图谱，获取概念的前后置关系和教材来源。"
            "当学生的问题涉及特定数学概念时，建议先查 KG 确认概念定义和前驱知识，"
            "再根据前驱链判断学生可能卡在哪里。每轮最多调用 2 次工具。"
        )

        prompt = build_qa_prompt(
            question,
            history=turn_input.history,
            teaching_mode=turn_input.teaching_mode,
            socratic_submode=turn_input.socratic_submode,
            screenshot_note=screenshot_note or None,
        ) + kg_hint

        # ---- 构建多模态 user message ----
        user_content: list[dict] = []
        if turn_input.image_data:
            user_content.append({"type": "image_url", "image_url": {"url": turn_input.image_data}})
        user_content.append({"type": "text", "text": prompt})
        initial_messages: list[dict] = [{"role": "user", "content": user_content}]

        # ---- 检查 LLM + 工具 ----
        if not llm_service.is_available():
            yield sse_error("LLM 服务未配置：请在 .env 中设置 QA_LLM_API_KEY")
            return

        from app.services.agents.tools import get_qa_tool_defs
        from app.services.agents.tool_def import ToolDef
        from app.services.agents.tool_runtime import (
            ToolRuntime, ToolRuntimeConfig, ToolRuntimeContext,
        )

        tool_defs: list[ToolDef] = get_qa_tool_defs()

        if not tool_defs:
            # 没有工具，降级为直接回答
            async for event in answer_turn(turn_input):
                yield event
            return

        yield sse_stage("planning", "正在组织本轮讲解策略...")

        # ---- 创建 model_call 闭包（支持工具调用的非流式调用）----
        async def model_call(messages, tools, tool_choice="auto"):
            return llm_service.chat_with_tools(
                messages, tools, tool_choice=tool_choice, temperature=0.3,
            )

        # ---- 启动 ToolRuntime ----
        runtime = ToolRuntime(
            tools=tool_defs,
            model_call=model_call,
            config=ToolRuntimeConfig(
                max_model_rounds=3,
                max_total_calls=4,
                max_consecutive_failure_rounds=2,
            ),
        )
        context = ToolRuntimeContext(
            turn_id=turn_id,
            user_id=turn_input.user_id or "",
            chat_history_id=turn_input.chat_id,
        )

        full_answer = ""
        tool_events_count = 0

        async for event in runtime.run(initial_messages, context):
            event_type = event.type
            data = event.data

            if event_type == "tool_call":
                tool_events_count += 1
                name = data.get("name", "")
                status_text = data.get("status_text", f"正在查询...")
                yield sse_stage("tool", status_text)

            elif event_type == "tool_result":
                status = data.get("status", "")
                name = data.get("name", "")
                if status == "error":
                    yield sse_stage("tool", f"{name} 查询失败，继续回答...")

            elif event_type == "final":
                result = data.get("result")
                if result:
                    full_answer = result.content or ""
                    # 流式输出最终回答
                    if full_answer:
                        yield sse_text(full_answer)

        # ---- 更新截图缓存 ----
        cache_id = screenshot_context.get("cache_id")
        if cache_id and full_answer:
            await run_in_threadpool(update_vision_summary, cache_id, full_answer[:4000])

        latency_ms = int((time.perf_counter() - started_at) * 1000)
        yield sse_done(
            full_text=full_answer, thinking="", sources=[],
            screenshot_context_id=cache_id or None,
            qa_turn_id=turn_id, latency_ms=latency_ms,
        )

    except asyncio.CancelledError:
        raise
    except Exception as exc:
        yield sse_error(f"回答生成失败：{exc}")
