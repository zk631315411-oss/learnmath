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
import json
import logging
import time
import uuid
from typing import AsyncIterator

from fastapi.concurrency import run_in_threadpool

from app.config import config
from app.services.agents.one_shot_tool import run_one_shot_tool
from app.services.agents.tools.report_turn_outcome import build_report_turn_outcome_tool
from app.services.llm_service import llm_service
from app.services.qa import evidence_reporting
from app.services.learning.progress import project_user_progress
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
    sse_event,
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

    # chat_id identifies the thread/root marker; every SSE turn needs its own
    # trace id so follow-ups can be counted independently.
    turn_id = str(uuid.uuid4())
    started_at = time.perf_counter()
    memory_scope = None
    memory_scope_token = None
    if config.LEARNER_MODEL_ENABLED:
        from app.services.learning.learning_memory_scope import begin_memory_scope
        memory_scope, memory_scope_token = begin_memory_scope(
            turn_input.user_id,
            turn_input.textbook_id,
            qa_turn_id=turn_id,
        )

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

        # Mutable for the lifetime of this turn: the learner-model tool may
        # only read nodes that the KG tool has already resolved in this same
        # answer context.
        turn_resolved_node_ids: set[str] = set()
        turn_resolved_node_ids_in_order: list[str] = []

        tool_kwargs = {
            "textbook_id": turn_input.textbook_id,
            "page_number": turn_input.page_number,
        }
        # Keep the old call signature while the feature is disabled; this is
        # useful for downstream integrations that provide their own tool list.
        if config.LEARNER_MODEL_ENABLED:
            tool_kwargs["user_id"] = turn_input.user_id
            tool_kwargs["allowed_node_ids"] = turn_resolved_node_ids
        tool_defs: list[ToolDef] = get_qa_tool_defs(**tool_kwargs)
        if not tool_defs:
            yield sse_error("KG 工具未配置，无法启动统一教学 Agent；未执行无工具直答")
            return
        if turn_input.user_id:
            from app.services.agents.tools.render_manim_animation import build_render_manim_tool
            tool_defs.append(build_render_manim_tool(
                user_id=turn_input.user_id,
                chat_id=turn_input.chat_id,
                client_turn_id=turn_input.client_turn_id,
            ))

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

        async def one_shot_model_call(messages, tools, tool_choice="auto"):
            return await asyncio.to_thread(
                llm_service.chat_with_tools,
                messages,
                tools,
                tool_choice=tool_choice,
                temperature=0.3,
                stream=False,
            )

        # ---- 启动 ToolRuntime ----
        runtime = ToolRuntime(
            tools=tool_defs,
            model_call=model_call,
            artifact_handler=_accept_manim_artifact,
            config=ToolRuntimeConfig(
                max_model_rounds=7,
                # KG 3 + index 2 (含 1 次修正重试) + detail 1 + manim 1 + retry margin 1 = 8.
                max_total_calls=8,
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
        memory_status_activity_id: str | None = None
        evidence_log = logging.getLogger("learnmath.evidence")

        # 自评证据回路的线程 resolved 节点集合：本轮集合已在工具装配前创建，
        # 供 learner-model 工具做同轮 KG 绑定；线程历史从已存 chat_history 恢复。
        # 线程历史只在主回答完成后、判断 evidence eligibility 时读取一次。
        thread_resolved_node_ids: set[str] | None = None
        thread_resolved_node_ids_recent_first: list[str] = []
        runtime_messages: list[dict] | None = None
        fork_attempted = False
        fork_tool_succeeded = False
        report_path = "none"
        evidence_persisted = 0
        invalid_node_ids = 0
        progress_delta: dict | None = None
        manim_artifacts: list[dict] = []

        async for event in runtime.run(initial_messages, context):
            event_type = event.type
            data = event.data

            if event_type == "tool_call":
                call_id = str(data.get("tool_call_id") or "")
                tool_name = str(data.get("name") or "")
                if tool_name in _INTERNAL_MEMORY_TOOLS:
                    # Keep the model payload private while exposing one
                    # sanitized, persisted status activity for the student.
                    if memory_status_activity_id is None:
                        memory_status_activity_id = f"learning-memory-{turn_id}"
                    activity = _memory_status_activity(
                        memory_status_activity_id,
                        "running",
                    )
                    tool_activities[memory_status_activity_id] = activity
                    yield sse_tool_call(activity)
                    continue
                public_arguments = dict(data.get("arguments") or {})
                if tool_name == "render_manim_animation":
                    public_arguments.pop("scene_code", None)
                activity = {
                    "id": call_id,
                    "tool": tool_name,
                    "label": str(data.get("display_name") or "调用辅助工具"),
                    "status": "running",
                    "arguments": public_arguments,
                    "round": data.get("round"),
                }
                tool_activities[call_id] = activity
                yield sse_tool_call(activity)

            elif event_type == "tool_result":
                call_id = str(data.get("tool_call_id") or "")
                tool_name = str(data.get("name") or "")
                result = data.get("result") or {}

                if (
                    tool_name == "retrieve_kg_context"
                    and str(data.get("status") or "") == "success"
                    and result.get("status") == "resolved"
                ):
                    # 累积本轮 resolved 节点；供 report_turn_outcome 的 node_id 合法性校验
                    resolved_in_order = evidence_reporting.extract_resolved_node_ids_in_order([
                        {"tool": tool_name, "result": result}
                    ])
                    turn_resolved_node_ids.update(resolved_in_order)
                    for node_id in resolved_in_order:
                        if node_id not in turn_resolved_node_ids_in_order:
                            turn_resolved_node_ids_in_order.append(node_id)
                    # P0-2 计数②：retrieve 出现 resolved 结果的轮次数（一次 resolved 记一行）
                    evidence_log.info(
                        "learnmath.evidence: resolved 结果出现 user=%s turn=%s",
                        turn_input.user_id, turn_id,
                    )

                if tool_name in _INTERNAL_MEMORY_TOOLS:
                    if memory_status_activity_id is None:
                        memory_status_activity_id = f"learning-memory-{turn_id}"
                    memory_status = _memory_status_from_result(data)
                    activity = _memory_status_activity(
                        memory_status_activity_id,
                        memory_status,
                        duration_ms=data.get("duration_ms"),
                    )
                    tool_activities[memory_status_activity_id] = activity
                    yield sse_tool_result(activity)
                    continue

                activity = tool_activities.setdefault(call_id, {
                    "id": call_id,
                    "tool": tool_name,
                    "label": "调用辅助工具",
                    "arguments": data.get("arguments") or {},
                })
                activity.update({
                    "status": str(data.get("status") or "error"),
                    "result": result,
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

            elif event_type == "visualization":
                artifact = dict(data)
                manim_artifacts.append(artifact)
                yield sse_event("artifact", artifact)

            elif event_type == "content_delta":
                text = str(data.get("text") or "")
                if text:
                    full_answer += text
                    yield sse_text(text)

            elif event_type == "final":
                result = data.get("result")
                if result:
                    runtime_messages = result.messages
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

        main_latency_ms = int((time.perf_counter() - started_at) * 1000)
        if thread_resolved_node_ids is None:
            (
                thread_resolved_node_ids,
                thread_resolved_node_ids_recent_first,
            ) = evidence_reporting.load_thread_resolved_node_context(
                turn_input.chat_id, turn_input.user_id,
            )
        eligible = bool(turn_resolved_node_ids or thread_resolved_node_ids)
        fork_latency_ms = 0

        if eligible:
            yield sse_stage("evidence_report", "正在记录学习进度…")
            fork_started_at = time.perf_counter()
            fork_attempted = True
            report_tool = build_report_turn_outcome_tool()
            allowed_node_ids = evidence_reporting.select_evidence_candidate_node_ids(
                turn_node_ids=turn_resolved_node_ids_in_order,
                thread_node_ids_recent_first=thread_resolved_node_ids_recent_first,
                user_id=turn_input.user_id,
                turn_id=turn_id,
            )
            # ToolRuntimeResult.messages intentionally stops before the final
            # visible assistant answer. This keeps the rating anchored to the
            # student's latest message and all help received before it.
            fork_messages = [
                *_filter_evidence_fork_messages(runtime_messages or initial_messages),
                {
                    "role": "system",
                    "content": (
                        "本次评价锚点是上下文中学生最近一条消息；教师针对该消息刚生成的回复"
                        "不在本次评价范围内。本轮可用的 selected_node.node_id 仅有："
                        f"{json.dumps(allowed_node_ids, ensure_ascii=False)}。"
                        "检查此前完整对话：学生未借助老师提示且自行正确作答报 independent；"
                        "此前得到提示或拆步后正确答出报 assisted；老师应学生要求完整讲解了"
                        "知识点（直接给答案/完整解法）而学生没有后续独立作答的报 direct_taught"
                        "——direct_taught 只表示「讲授发生过、需要复习」，不要求学生说「我懂了」，"
                        "学生离开或未回应不等于教学没发生；连讲授都没发生、没有任何闭合信号的"
                        "才报 unresolved。scaffolding_level=4（完整讲解）且学生未独立作答时"
                        "对应 direct_taught，不得报 assisted 或 unresolved。"
                        "只调用 report_turn_outcome，不要输出学生可见内容。"
                    ),
                },
            ]
            try:
                fork_result = await run_one_shot_tool(
                    messages=fork_messages,
                    tool=report_tool,
                    model_call=one_shot_model_call,
                )
                outcome = fork_result.outcome
                if outcome is not None and outcome.status == "success":
                    fork_tool_succeeded = True
                    report_path = "evidence_fork"
                    report_args = outcome.normalized_arguments
                    requested_node_ids = list(report_args.get("node_ids") or [])
                    written = evidence_reporting.validate_and_report(
                        user_id=turn_input.user_id,
                        chat_id=turn_input.chat_id,
                        qa_turn_id=turn_id,
                        textbook_id=turn_input.textbook_id,
                        node_ids=requested_node_ids,
                        scaffolding_level=int(report_args.get("scaffolding_level") or 0),
                        outcome=str(report_args.get("student_outcome") or ""),
                        turn_resolved_node_ids=turn_resolved_node_ids,
                        thread_resolved_node_ids=thread_resolved_node_ids,
                        report_path="evidence_fork",
                        client_turn_id=turn_input.client_turn_id,
                    )
                    evidence_persisted += written
                    invalid_node_ids += max(0, len(requested_node_ids) - written)
                    if written:
                        persisted_node_ids = [
                            node_id for node_id in requested_node_ids
                            if node_id in (turn_resolved_node_ids | thread_resolved_node_ids)
                            and node_id.startswith(f"{turn_input.textbook_id}:")
                        ]
                        if persisted_node_ids:
                            progress_delta = await run_in_threadpool(
                                project_user_progress,
                                turn_input.user_id,
                                turn_input.textbook_id,
                                node_ids=persisted_node_ids,
                            )
                            # Estimates are computed from evidence at read
                            # time; no post-answer replay or delta needed.
                else:
                    evidence_log.warning(
                        "learnmath.evidence: evidence fork failed user=%s turn=%s code=%s detail=%s",
                        turn_input.user_id,
                        turn_id,
                        fork_result.error_code or getattr(outcome, "error_code", None),
                        fork_result.error_message or getattr(outcome, "error_message", None),
                    )
            except Exception:
                evidence_log.exception(
                    "learnmath.evidence: evidence fork provider failure user=%s turn=%s",
                    turn_input.user_id,
                    turn_id,
                )
            finally:
                fork_latency_ms = int((time.perf_counter() - fork_started_at) * 1000)

        latency_ms = int((time.perf_counter() - started_at) * 1000)
        turn_metrics = {
                "qa_turn_id": turn_id,
                "eligible": eligible,
                "fork_attempted": fork_attempted,
                "fork_tool_succeeded": fork_tool_succeeded,
                "report_path": report_path,
                "evidence_persisted": evidence_persisted,
                "invalid_node_ids": invalid_node_ids,
                "main_latency_ms": main_latency_ms,
                "fork_latency_ms": fork_latency_ms,
                "total_latency_ms": latency_ms,
        }
        evidence_log.info(
            "learnmath.evidence.turn_metrics %s",
            json.dumps(turn_metrics, ensure_ascii=False, sort_keys=True),
        )
        yield sse_done(
            full_text=full_answer, thinking=full_thinking, sources=[],
            tool_activities=list(tool_activities.values()),
            screenshot_context_id=cache_id or None,
            qa_turn_id=turn_id, latency_ms=latency_ms,
            progress_delta=progress_delta,
            artifacts=manim_artifacts,
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
    finally:
        if memory_scope is not None and memory_scope_token is not None:
            from app.services.learning.learning_memory_scope import reset_memory_scope
            reset_memory_scope(memory_scope_token, memory_scope)


async def _accept_manim_artifact(artifact: dict, _outcome) -> dict | None:
    return artifact if artifact.get("id") else None


_INTERNAL_MEMORY_TOOLS = {
    "retrieve_learning_memory_index",
    "retrieve_learning_memory_detail",
    # Historical sessions may still contain this name.  It must stay hidden
    # during replay without being registered as a live tool.
    "retrieve_learner_model_context",
}


def _memory_status_from_result(data: dict) -> str:
    """Map private memory tool outcomes to the four public UI states."""

    if str(data.get("status") or "") != "success":
        return "error"
    result = data.get("result") or {}
    status = str(result.get("status") or "")
    if status == "partial":
        return "partial"
    if status == "ok":
        return "success"
    return "error"


def _memory_status_activity(
    activity_id: str,
    status: str,
    *,
    duration_ms: int | None = None,
) -> dict:
    """Build a safe activity with no private arguments or model fields."""

    safe_status = status if status in {"running", "success", "partial", "error"} else "error"
    activity = {
        "id": activity_id,
        "tool": "learning_memory_status",
        "label": "学习记录",
        "status": "running" if safe_status == "running" else "success" if safe_status in {"success", "partial"} else "error",
        "arguments": {},
        "result": {"memory_status": safe_status},
    }
    if duration_ms is not None:
        activity["duration_ms"] = duration_ms
    return activity


def _filter_evidence_fork_messages(messages: list[dict]) -> list[dict]:
    """Remove memory decisions and private reasoning from the evidence fork."""

    filtered: list[dict] = []
    hidden_call_ids: set[str] = set()
    for source in messages:
        if not isinstance(source, dict):
            continue
        message = dict(source)
        message.pop("reasoning_content", None)
        message.pop("thinking", None)
        role = str(message.get("role") or "")
        if role == "assistant" and message.get("tool_calls"):
            kept_calls = []
            for call in message.get("tool_calls") or []:
                if not isinstance(call, dict):
                    continue
                function = call.get("function") or {}
                name = str(function.get("name") or "")
                if name in _INTERNAL_MEMORY_TOOLS:
                    hidden_call_ids.add(str(call.get("id") or ""))
                    continue
                kept_calls.append(call)
            if kept_calls:
                message["tool_calls"] = kept_calls
            else:
                message.pop("tool_calls", None)
            # Tool-call round content is not part of the student's observed
            # response; keep only non-memory tool calls for the fork.
            message.pop("content", None)
        elif role == "assistant":
            # A completed assistant response must never become evidence-fork
            # input. Historical assistant messages are represented in the
            # user history text, not as raw assistant messages here.
            continue
        if role == "tool" and str(message.get("tool_call_id") or "") in hidden_call_ids:
            continue
        if role == "tool" and str(message.get("name") or "") in _INTERNAL_MEMORY_TOOLS:
            continue
        filtered.append(message)
    return filtered
