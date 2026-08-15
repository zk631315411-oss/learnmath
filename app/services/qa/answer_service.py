"""QA 回答编排入口 — Agent 架构版（阶段 1）。

文字和截图统一进入 answer_turn_with_tools()：Agent 自主决定是否调用 KG 查询。
截图只是 user message 中的一种内容类型，不再决定是否使用工具。

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
from app.services.qa.prompt_builder import (
    build_system_prompt,
    build_user_message,
    build_user_message_with_image,
)
from app.services.qa.streaming_service import (
    sse_done,
    sse_error,
    sse_stage,
    sse_text,
    sse_thinking,
    sse_tool_call,
    sse_tool_result,
)
from app.services.qa.vision_context_service import (
    prepare_screenshot_context,
    update_vision_summary,
)


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

        # ---- 构建标准 system + 多模态 user messages ----
        system_prompt = build_system_prompt(screenshot_note=screenshot_note)
        if turn_input.image_data:
            user_messages = build_user_message_with_image(
                question,
                turn_input.image_data,
                history=turn_input.history,
            )
        else:
            user_messages = build_user_message(question, history=turn_input.history)
        initial_messages: list[dict] = [
            {"role": "system", "content": system_prompt},
            *user_messages,
        ]

        # ---- 检查 LLM + 工具 ----
        if not llm_service.is_available():
            yield sse_error("LLM 服务未配置：请在 .env 中设置 QA_LLM_API_KEY")
            return

        from app.services.agents.tools import get_qa_tool_defs
        from app.services.agents.tool_def import ToolDef
        from app.services.agents.tool_runtime import (
            ToolRuntime, ToolRuntimeConfig, ToolRuntimeContext,
        )

        tool_defs: list[ToolDef] = get_qa_tool_defs(
            textbook_id=turn_input.textbook_id,
            page_number=turn_input.page_number,
        )

        if not tool_defs:
            yield sse_error("KG 工具未配置，无法启动统一教学 Agent；未执行无工具直答")
            return

        yield sse_stage("planning", "正在组织本轮讲解策略...")

        # ---- 创建 model_call 闭包（流式工具调用 + 流式最终回答）----
        async def model_call(messages, tools, tool_choice="auto"):
            return await asyncio.to_thread(
                llm_service.chat_with_tools,
                messages,
                tools,
                tool_choice=tool_choice,
                temperature=0.3,
                stream=True,
            )

        # ---- 启动 ToolRuntime ----
        runtime = ToolRuntime(
            tools=tool_defs,
            model_call=model_call,
            config=ToolRuntimeConfig(
                max_model_rounds=5,
                max_total_calls=3,
                max_consecutive_failure_rounds=2,
            ),
        )
        context = ToolRuntimeContext(
            turn_id=turn_id,
            user_id=turn_input.user_id or "",
            chat_history_id=turn_input.chat_id,
        )

        full_answer = ""
        full_thinking = ""
        tool_activities: dict[str, dict] = {}

        async for event in runtime.run(initial_messages, context):
            event_type = event.type
            data = event.data

            if event_type == "tool_call":
                call_id = str(data.get("tool_call_id") or "")
                activity = {
                    "id": call_id,
                    "tool": str(data.get("name") or ""),
                    "label": str(data.get("display_name") or "调用辅助工具"),
                    "status": "running",
                    "arguments": data.get("arguments") or {},
                    "round": data.get("round"),
                }
                tool_activities[call_id] = activity
                yield sse_tool_call(activity)

            elif event_type == "tool_result":
                call_id = str(data.get("tool_call_id") or "")
                activity = tool_activities.setdefault(call_id, {
                    "id": call_id,
                    "tool": str(data.get("name") or ""),
                    "label": "调用辅助工具",
                    "arguments": data.get("arguments") or {},
                })
                activity.update({
                    "status": str(data.get("status") or "error"),
                    "result": data.get("result") or {},
                    "duration_ms": data.get("duration_ms"),
                    "error_code": data.get("error_code"),
                    "error_message": data.get("error_message"),
                })
                yield sse_tool_result(activity)

            elif event_type == "thinking_delta":
                text = str(data.get("text") or "")
                if text:
                    full_thinking += text
                    yield sse_thinking(text)

            elif event_type == "content_delta":
                text = str(data.get("text") or "")
                if text:
                    full_answer += text
                    yield sse_text(text)

            elif event_type == "final":
                result = data.get("result")
                if result:
                    # 兼容非流式 model_call；流式路径已经通过 delta 输出。
                    if not full_answer and result.content:
                        full_answer = result.content
                        yield sse_text(full_answer)
                    if not full_thinking and result.reasoning:
                        full_thinking = result.reasoning
                        yield sse_thinking(full_thinking)

        # ---- 更新截图缓存 ----
        cache_id = screenshot_context.get("cache_id")
        if cache_id and full_answer:
            await run_in_threadpool(update_vision_summary, cache_id, full_answer[:4000])

        latency_ms = int((time.perf_counter() - started_at) * 1000)
        yield sse_done(
            full_text=full_answer, thinking=full_thinking, sources=[],
            tool_activities=list(tool_activities.values()),
            screenshot_context_id=cache_id or None,
            qa_turn_id=turn_id, latency_ms=latency_ms,
        )

    except asyncio.CancelledError:
        raise
    except Exception as exc:
        if turn_input.image_data:
            yield sse_error(
                "截图 Agent 调用失败：当前模型必须支持‘图片 + 工具调用’组合；"
                f"未降级为无 KG 直答。原始错误：{exc}"
            )
        else:
            yield sse_error(f"回答生成失败：{exc}")
