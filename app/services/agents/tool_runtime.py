"""Bounded, observable runtime for OpenAI-compatible function calling."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections import Counter
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any, Awaitable, Callable, Literal

from app.services.agents.tool_def import ToolDef
from app.services.agents.tool_executor import (
    PreparedToolCall,
    ToolOutcome,
    execute_prepared_tool_call,
    prepare_tool_call,
)


logger = logging.getLogger("tool_runtime")


RuntimeEventType = Literal[
    "tool_call", "tool_result", "visualization",
    "thinking_delta", "content_delta", "round_injection_status", "final",
]
ModelCall = Callable[..., Awaitable[Any]]
ArtifactHandler = Callable[[dict[str, Any], ToolOutcome], Awaitable[dict[str, Any] | None]]
TraceHandler = Callable[[dict[str, Any]], Awaitable[None]]
# Server-side context injection hook: invoked once per tool round after the
# round's tool messages have been appended, before the next model call.
# Receives (round_index, completed outcome summaries) and returns an extra
# message dict to append to the working list, or None.
RoundInjector = Callable[[int, list[dict[str, Any]]], Awaitable[Any]]
RoundInjectionStatusHook = Callable[[int, list[dict[str, Any]]], Awaitable[dict[str, Any] | None]]


@dataclass(frozen=True)
class RoundInjection:
    """A private message injected between tool rounds plus safe UI metadata.

    The message is never emitted as an SSE payload.  ``status`` is deliberately
    limited to the public activity vocabulary so a callback cannot accidentally
    expose model fields or raw memory text through the runtime event stream.
    """

    message: dict[str, Any] | None = None
    status: Literal["success", "partial", "error"] = "success"
    duration_ms: int | None = None
    error_code: str | None = None


@dataclass(frozen=True)
class ToolRuntimeConfig:
    max_model_rounds: int = 5
    max_total_calls: int = 8
    max_consecutive_failure_rounds: int = 2
    tool_choice: str | dict[str, Any] = "auto"


@dataclass(frozen=True)
class ToolRuntimeContext:
    turn_id: str
    user_id: str
    chat_history_id: str | None = None
    assistant_message_id: str | None = None
    model_name: str = ""


@dataclass
class RuntimeEvent:
    type: RuntimeEventType
    data: dict[str, Any]


@dataclass
class ToolRuntimeResult:
    content: str
    reasoning: str
    messages: list[dict[str, Any]]
    visualizations: list[dict[str, Any]] = field(default_factory=list)
    degraded: bool = False
    degradation_code: str | None = None
    stats: dict[str, int] = field(default_factory=dict)
    model_rounds: int = 0


def _coerce_round_injection(value: RoundInjection | dict[str, Any] | None) -> RoundInjection:
    """Keep legacy dict callbacks working while enforcing a safe result shape."""

    if isinstance(value, RoundInjection):
        return value
    if isinstance(value, dict):
        message = value if value.get("content") else None
        return RoundInjection(message=message, status="success" if message else "partial")
    return RoundInjection(status="partial")


def _safe_round_injection_status(value: dict[str, Any]) -> dict[str, Any]:
    """Return only fields allowed in the public runtime activity event."""

    status = str(value.get("status") or "error")
    if status not in {"running", "success", "partial", "error"}:
        status = "error"
    result: dict[str, Any] = {"status": status}
    duration = value.get("duration_ms")
    if isinstance(duration, (int, float)) and duration >= 0:
        result["duration_ms"] = int(duration)
    error_code = value.get("error_code")
    if error_code and status == "error":
        result["error_code"] = str(error_code)[:64]
    return result


class ToolRuntime:
    def __init__(
        self,
        *,
        tools: list[ToolDef],
        model_call: ModelCall,
        config: ToolRuntimeConfig | None = None,
        artifact_handler: ArtifactHandler | None = None,
        trace_handler: TraceHandler | None = None,
        round_injector: RoundInjector | None = None,
        round_injection_status: RoundInjectionStatusHook | None = None,
    ) -> None:
        self.tools = tools
        self.model_call = model_call
        self.config = config or ToolRuntimeConfig()
        self.artifact_handler = artifact_handler
        self.trace_handler = trace_handler
        self.round_injector = round_injector
        self.round_injection_status = round_injection_status
        self._tool_map = {tool.name: tool for tool in tools}

    async def run(self, messages: list[dict[str, Any]], context: ToolRuntimeContext):
        working = list(messages)
        seen: set[str] = set()
        per_tool: Counter[str] = Counter()
        stats: Counter[str] = Counter(called=0, succeeded=0, failed=0, skipped=0)
        visualizations: list[dict[str, Any]] = []
        failure_rounds = 0
        degraded = False
        degradation_code: str | None = None
        rounds = 0
        reasoning_parts: list[str] = []

        while rounds < self.config.max_model_rounds:
            rounds += 1
            response = await self.model_call(
                messages=working,
                tools=[tool.to_openai_tool() for tool in self.tools],
                tool_choice=self.config.tool_choice,
            )
            if hasattr(response, "choices"):
                message = response.choices[0].message
                reasoning = str(getattr(message, "reasoning_content", "") or "")
                if reasoning:
                    reasoning_parts.append(reasoning)
                    yield RuntimeEvent("thinking_delta", {"text": reasoning})
                content = str(getattr(message, "content", "") or "")
                if content:
                    yield RuntimeEvent("content_delta", {"text": content})
            else:
                streamed = _StreamedMessage()
                async for chunk in _iterate_stream(response):
                    for event in streamed.consume(chunk):
                        if event.type == "thinking_delta":
                            reasoning_parts.append(str(event.data.get("text") or ""))
                        yield event
                message = streamed.message()
            calls = list(getattr(message, "tool_calls", None) or [])
            if not calls:
                result = ToolRuntimeResult(
                    content=str(getattr(message, "content", "") or ""),
                    reasoning="".join(reasoning_parts),
                    messages=working,
                    visualizations=visualizations,
                    degraded=degraded,
                    degradation_code=degradation_code,
                    stats=dict(stats),
                    model_rounds=rounds,
                )
                yield RuntimeEvent("final", {"result": result})
                return

            working.append(_assistant_message(message, calls))
            prepared_to_run: list[PreparedToolCall] = []
            prepared_meta: list[tuple[Any, str]] = []
            immediate: list[tuple[Any, ToolOutcome, str]] = []
            round_per_tool: Counter[str] = Counter()

            for call in calls:
                name = str(getattr(call.function, "name", ""))
                display_name = self._tool_map.get(name).display_name if name in self._tool_map else "调用辅助工具"
                status_text = display_name if display_name.startswith("正在") else f"正在{display_name}"
                stats["called"] += 1
                prepared = prepare_tool_call(call, self.tools)
                arguments = (
                    prepared.normalized_arguments
                    if isinstance(prepared, ToolOutcome)
                    else prepared.arguments
                )
                yield RuntimeEvent("tool_call", {
                    "tool_call_id": str(call.id),
                    "name": name,
                    "display_name": display_name,
                    "status_text": status_text,
                    "arguments": arguments,
                    "round": rounds,
                })
                if isinstance(prepared, ToolOutcome):
                    immediate.append((call, prepared, _raw_fingerprint(context.turn_id, name, call.function.arguments)))
                    continue
                fingerprint = call_fingerprint(context.turn_id, name, prepared.arguments)
                if fingerprint in seen:
                    immediate.append((call, _skipped(call, name, "duplicate_call", "相同工具调用已执行"), fingerprint))
                    continue
                if stats["called"] > self.config.max_total_calls:
                    immediate.append((call, _skipped(call, name, "budget_exceeded", "工具调用已达到本轮上限"), fingerprint))
                    continue
                tool = prepared.tool
                if round_per_tool[name] >= tool.max_calls_per_round:
                    immediate.append((call, _skipped(call, name, "budget_exceeded", "该工具已达到本轮调用上限"), fingerprint))
                    continue
                if per_tool[name] >= tool.max_calls_per_turn:
                    immediate.append((call, _skipped(call, name, "budget_exceeded", "该工具已达到本轮上限"), fingerprint))
                    continue
                seen.add(fingerprint)
                round_per_tool[name] += 1
                per_tool[name] += 1
                prepared_to_run.append(prepared)
                prepared_meta.append((call, fingerprint))

            outcomes = await asyncio.gather(
                *(execute_prepared_tool_call(item) for item in prepared_to_run)
            ) if prepared_to_run else []
            completed = immediate + [
                (call, outcome, fingerprint)
                for (call, fingerprint), outcome in zip(prepared_meta, outcomes)
            ]
            round_success = False
            for call, outcome, fingerprint in completed:
                accepted_ids: list[str] = []
                accepted_artifacts: list[dict[str, Any]] = []
                if outcome.status == "success":
                    try:
                        for artifact in outcome.artifacts:
                            if self.artifact_handler is None:
                                continue
                            accepted = await self.artifact_handler(artifact, outcome)
                            if accepted:
                                visualizations.append(accepted)
                                accepted_artifacts.append(accepted)
                                accepted_ids.append(str(accepted.get("id") or ""))
                    except Exception:
                        logger.exception("artifact persistence failed for tool %s", outcome.tool_name)
                        outcome.status = "error"
                        outcome.error_code = "execution_failed"
                        outcome.error_message = "生成结果保存失败"
                        outcome.retryable = True
                        outcome.model_payload = {}
                        outcome.artifacts = []
                    if outcome.status == "success":
                        round_success = True
                        stats["succeeded"] += 1
                    else:
                        stats["failed"] += 1
                elif outcome.status == "skipped":
                    stats["skipped"] += 1
                else:
                    stats["failed"] += 1
                working.append(outcome.as_tool_message())
                yield RuntimeEvent("tool_result", {
                    "tool_call_id": outcome.tool_call_id,
                    "name": outcome.tool_name,
                    "status": outcome.status,
                    "error_code": outcome.error_code,
                    "error_message": outcome.error_message,
                    "arguments": outcome.normalized_arguments,
                    "result": outcome.public_result,
                    "duration_ms": outcome.duration_ms,
                })
                for accepted in accepted_artifacts:
                    yield RuntimeEvent("visualization", accepted)
                if self.trace_handler is not None:
                    try:
                        await self.trace_handler({
                            "context": context, "round_index": rounds,
                            "fingerprint": fingerprint, "outcome": outcome,
                            "artifact_ids": accepted_ids,
                        })
                    except Exception:
                        logger.exception("tool trace persistence failed")

            injection_started = False
            if self.round_injector is not None:
                completed_summaries = [
                    {
                        "name": outcome.tool_name,
                        "status": outcome.status,
                        "public_result": outcome.public_result,
                    }
                    for _call, outcome, _fingerprint in completed
                ]
                if self.round_injection_status is not None:
                    try:
                        status_data = await self.round_injection_status(
                            rounds, completed_summaries,
                        )
                    except Exception:
                        logger.exception("round injection status hook failed")
                        status_data = None
                    if isinstance(status_data, dict) and status_data.get("status") == "running":
                        injection_started = True
                        yield RuntimeEvent(
                            "round_injection_status",
                            _safe_round_injection_status(status_data),
                        )
                try:
                    injection = await self.round_injector(rounds, completed_summaries)
                except Exception:
                    logger.exception("round injector failed")
                    injection = RoundInjection(status="error", error_code="injection_failed")
                normalized = _coerce_round_injection(injection)
                if normalized.message and normalized.message.get("content"):
                    working.append(normalized.message)
                if injection_started:
                    yield RuntimeEvent(
                        "round_injection_status",
                        _safe_round_injection_status({
                            "status": normalized.status,
                            "duration_ms": normalized.duration_ms,
                            "error_code": normalized.error_code,
                        }),
                    )

            failure_rounds = 0 if round_success else failure_rounds + 1
            budget_hit = stats["called"] >= self.config.max_total_calls
            if budget_hit or failure_rounds >= self.config.max_consecutive_failure_rounds:
                degraded = True
                degradation_code = "tool_budget_exceeded" if budget_hit else "tool_failures"
                break

        if not degraded:
            degraded = True
            degradation_code = "tool_round_limit"
        final_response = await self.model_call(
            messages=working + [{
                "role": "system",
                "content": "工具调用现已结束。请仅基于已有教材上下文、成功工具结果和已生成示意图完成文字回答，不要再调用工具。",
            }],
            tools=[tool.to_openai_tool() for tool in self.tools],
            tool_choice="none",
        )
        if hasattr(final_response, "choices"):
            final_message = final_response.choices[0].message
            reasoning = str(getattr(final_message, "reasoning_content", "") or "")
            if reasoning:
                reasoning_parts.append(reasoning)
                yield RuntimeEvent("thinking_delta", {"text": reasoning})
            content = str(getattr(final_message, "content", "") or "")
            if content:
                yield RuntimeEvent("content_delta", {"text": content})
        else:
            streamed = _StreamedMessage()
            async for chunk in _iterate_stream(final_response):
                for event in streamed.consume(chunk):
                    if event.type == "thinking_delta":
                        reasoning_parts.append(str(event.data.get("text") or ""))
                    yield event
            final_message = streamed.message()
        result = ToolRuntimeResult(
            content=str(getattr(final_message, "content", "") or ""),
            reasoning="".join(reasoning_parts),
            messages=working,
            visualizations=visualizations,
            degraded=degraded,
            degradation_code=degradation_code,
            stats=dict(stats),
            model_rounds=rounds + 1,
        )
        yield RuntimeEvent("final", {"result": result})


class _StreamedMessage:
    """Rebuild one assistant message while forwarding stream deltas."""

    def __init__(self) -> None:
        self.content_parts: list[str] = []
        self.reasoning_parts: list[str] = []
        self.tool_calls: dict[int, dict[str, str]] = {}

    def consume(self, chunk: Any) -> list[RuntimeEvent]:
        choices = getattr(chunk, "choices", None) or []
        if not choices:
            return []
        delta = getattr(choices[0], "delta", None)
        if delta is None:
            return []

        events: list[RuntimeEvent] = []
        reasoning = str(getattr(delta, "reasoning_content", "") or "")
        if reasoning:
            self.reasoning_parts.append(reasoning)
            events.append(RuntimeEvent("thinking_delta", {"text": reasoning}))

        content = str(getattr(delta, "content", "") or "")
        if content:
            self.content_parts.append(content)
            events.append(RuntimeEvent("content_delta", {"text": content}))

        for item in list(getattr(delta, "tool_calls", None) or []):
            index = int(getattr(item, "index", 0) or 0)
            current = self.tool_calls.setdefault(index, {"id": "", "name": "", "arguments": ""})
            call_id = str(getattr(item, "id", "") or "")
            if call_id:
                current["id"] = call_id
            function = getattr(item, "function", None)
            if function is not None:
                current["name"] += str(getattr(function, "name", "") or "")
                current["arguments"] += str(getattr(function, "arguments", "") or "")
        return events

    def message(self) -> Any:
        calls = [
            SimpleNamespace(
                id=value["id"],
                function=SimpleNamespace(name=value["name"], arguments=value["arguments"]),
            )
            for _, value in sorted(self.tool_calls.items())
        ]
        return SimpleNamespace(
            content="".join(self.content_parts),
            reasoning_content="".join(self.reasoning_parts),
            tool_calls=calls,
        )


_STREAM_END = object()


def _next_stream_item(iterator: Any) -> Any:
    try:
        return next(iterator)
    except StopIteration:
        return _STREAM_END


async def _iterate_stream(response: Any):
    """Iterate provider streams without blocking the asyncio event loop."""
    if hasattr(response, "__aiter__"):
        async for chunk in response:
            yield chunk
        return

    iterator = iter(response)
    try:
        while True:
            chunk = await asyncio.to_thread(_next_stream_item, iterator)
            if chunk is _STREAM_END:
                break
            yield chunk
    finally:
        close = getattr(response, "close", None)
        if callable(close):
            await asyncio.to_thread(close)


def call_fingerprint(turn_id: str, tool_name: str, arguments: dict[str, Any]) -> str:
    canonical = json.dumps(arguments, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(f"{turn_id}\n{tool_name}\n{canonical}".encode("utf-8")).hexdigest()


def _raw_fingerprint(turn_id: str, tool_name: str, arguments: str) -> str:
    return hashlib.sha256(f"{turn_id}\n{tool_name}\n{arguments}".encode("utf-8", errors="replace")).hexdigest()


def _assistant_message(message: Any, calls: list[Any]) -> dict[str, Any]:
    value = {
        "role": "assistant", "content": getattr(message, "content", None),
        "tool_calls": [{
            "id": str(call.id), "type": "function",
            "function": {"name": str(call.function.name), "arguments": str(call.function.arguments)},
        } for call in calls],
    }
    reasoning = getattr(message, "reasoning_content", None)
    if reasoning:
        value["reasoning_content"] = reasoning
    return value


def _skipped(call: Any, name: str, code: str, message: str) -> ToolOutcome:
    return ToolOutcome(
        tool_call_id=str(call.id), tool_name=name, status="skipped",
        error_code=code, error_message=message, retryable=False,
    )
