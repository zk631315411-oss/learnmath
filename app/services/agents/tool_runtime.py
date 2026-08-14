"""Bounded, observable runtime for OpenAI-compatible function calling."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal

from app.services.agents.tool_def import ToolDef
from app.services.agents.tool_executor import (
    PreparedToolCall,
    ToolOutcome,
    execute_prepared_tool_call,
    prepare_tool_call,
)


logger = logging.getLogger("tool_runtime")


RuntimeEventType = Literal["tool_call", "tool_result", "visualization", "final"]
ModelCall = Callable[..., Awaitable[Any]]
ArtifactHandler = Callable[[dict[str, Any], ToolOutcome], Awaitable[dict[str, Any] | None]]
TraceHandler = Callable[[dict[str, Any]], Awaitable[None]]


@dataclass(frozen=True)
class ToolRuntimeConfig:
    max_model_rounds: int = 5
    max_total_calls: int = 8
    max_consecutive_failure_rounds: int = 2


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
    messages: list[dict[str, Any]]
    visualizations: list[dict[str, Any]] = field(default_factory=list)
    degraded: bool = False
    degradation_code: str | None = None
    stats: dict[str, int] = field(default_factory=dict)
    model_rounds: int = 0


class ToolRuntime:
    def __init__(
        self,
        *,
        tools: list[ToolDef],
        model_call: ModelCall,
        config: ToolRuntimeConfig | None = None,
        artifact_handler: ArtifactHandler | None = None,
        trace_handler: TraceHandler | None = None,
    ) -> None:
        self.tools = tools
        self.model_call = model_call
        self.config = config or ToolRuntimeConfig()
        self.artifact_handler = artifact_handler
        self.trace_handler = trace_handler
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

        while rounds < self.config.max_model_rounds:
            rounds += 1
            response = await self.model_call(
                messages=working,
                tools=[tool.to_openai_tool() for tool in self.tools],
                tool_choice="auto",
            )
            message = response.choices[0].message
            calls = list(getattr(message, "tool_calls", None) or [])
            if not calls:
                result = ToolRuntimeResult(
                    content=str(getattr(message, "content", "") or ""),
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
                yield RuntimeEvent("tool_call", {
                    "tool_call_id": str(call.id), "name": name,
                    "status_text": status_text, "round": rounds,
                })
                stats["called"] += 1
                prepared = prepare_tool_call(call, self.tools)
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
                    "status": "success" if outcome.status == "success" else "skipped" if outcome.status == "skipped" else "error",
                    "error_code": outcome.error_code,
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
        final_message = final_response.choices[0].message
        result = ToolRuntimeResult(
            content=str(getattr(final_message, "content", "") or ""),
            messages=working,
            visualizations=visualizations,
            degraded=degraded,
            degradation_code=degradation_code,
            stats=dict(stats),
            model_rounds=rounds + 1,
        )
        yield RuntimeEvent("final", {"result": result})


def call_fingerprint(turn_id: str, tool_name: str, arguments: dict[str, Any]) -> str:
    canonical = json.dumps(arguments, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(f"{turn_id}\n{tool_name}\n{canonical}".encode("utf-8")).hexdigest()


def _raw_fingerprint(turn_id: str, tool_name: str, arguments: str) -> str:
    return hashlib.sha256(f"{turn_id}\n{tool_name}\n{arguments}".encode("utf-8", errors="replace")).hexdigest()


def _assistant_message(message: Any, calls: list[Any]) -> dict[str, Any]:
    return {
        "role": "assistant", "content": getattr(message, "content", None),
        "tool_calls": [{
            "id": str(call.id), "type": "function",
            "function": {"name": str(call.function.name), "arguments": str(call.function.arguments)},
        } for call in calls],
    }


def _skipped(call: Any, name: str, code: str, message: str) -> ToolOutcome:
    return ToolOutcome(
        tool_call_id=str(call.id), tool_name=name, status="skipped",
        error_code=code, error_message=message, retryable=False,
    )
