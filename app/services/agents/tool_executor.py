"""Validated and bounded execution for registered agent tools."""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Literal

from app.services.agents.tool_def import ToolArgumentError, ToolDef


logger = logging.getLogger("tool_runtime.executor")


ToolStatus = Literal["success", "error", "skipped", "cancelled"]
ToolErrorCode = Literal[
    "invalid_arguments", "unknown_tool", "duplicate_call", "timeout",
    "execution_failed", "policy_denied", "budget_exceeded", "cancelled",
]


@dataclass
class ToolOutcome:
    tool_call_id: str
    tool_name: str
    status: ToolStatus
    model_payload: dict[str, Any] = field(default_factory=dict)
    artifacts: list[dict[str, Any]] = field(default_factory=list)
    error_code: ToolErrorCode | None = None
    error_message: str | None = None
    retryable: bool = False
    duration_ms: int = 0
    normalized_arguments: dict[str, Any] = field(default_factory=dict)

    def as_tool_message(self) -> dict[str, str]:
        payload = self.model_payload if self.status == "success" else {
            "error": {
                "code": self.error_code,
                "message": self.error_message or "工具调用失败",
                "retryable": self.retryable,
            }
        }
        return {
            "role": "tool",
            "tool_call_id": self.tool_call_id,
            "content": json.dumps(payload, ensure_ascii=False, allow_nan=False),
        }


class ToolExecutionError(Exception):
    """Backward-compatible public exception for direct executor callers."""


@dataclass(frozen=True)
class PreparedToolCall:
    tool_call_id: str
    tool_name: str
    tool: ToolDef
    arguments: dict[str, Any]


def prepare_tool_call(tool_call: Any, tools: list[ToolDef]) -> PreparedToolCall | ToolOutcome:
    """Validate a provider tool call without executing it."""
    started = time.perf_counter()
    name = str(getattr(getattr(tool_call, "function", None), "name", ""))
    call_id = str(getattr(tool_call, "id", ""))
    tool = _find_tool(name, tools)
    if tool is None or tool.execute is None:
        return _error(call_id, name, "unknown_tool", "请求的工具不可用", False, started)
    try:
        raw = json.loads(tool_call.function.arguments)
        if not isinstance(raw, dict):
            raise ToolArgumentError("工具参数必须是 JSON 对象")
        arguments = tool.validate_arguments(raw)
    except (json.JSONDecodeError, ToolArgumentError) as exc:
        return _error(call_id, name, "invalid_arguments", str(exc), True, started)
    return PreparedToolCall(call_id, name, tool, arguments)


async def execute_prepared_tool_call(prepared: PreparedToolCall) -> ToolOutcome:
    started = time.perf_counter()
    tool = prepared.tool
    arguments = prepared.arguments
    try:
        if inspect.iscoroutinefunction(tool.execute):
            result = await asyncio.wait_for(tool.execute(**arguments), timeout=tool.timeout_seconds)
        else:
            result = await asyncio.wait_for(
                asyncio.to_thread(tool.execute, **arguments),
                timeout=tool.timeout_seconds,
            )
    except asyncio.CancelledError:
        return _error(prepared.tool_call_id, prepared.tool_name, "cancelled", "工具调用已取消", False, started, status="cancelled", arguments=arguments)
    except asyncio.TimeoutError:
        return _error(prepared.tool_call_id, prepared.tool_name, "timeout", "工具执行超时", True, started, arguments=arguments)
    except Exception:
        logger.exception("tool execution failed: %s", prepared.tool_name)
        return _error(prepared.tool_call_id, prepared.tool_name, "execution_failed", "工具执行失败", True, started, arguments=arguments)

    model_payload = result
    artifacts: list[dict[str, Any]] = []
    if isinstance(result, dict) and "model_result" in result:
        model_payload = result.get("model_result") or {}
        raw_artifacts = result.get("artifacts")
        if isinstance(raw_artifacts, list):
            artifacts = [item for item in raw_artifacts if isinstance(item, dict)]
    if not isinstance(model_payload, dict):
        model_payload = {"result": model_payload}
    return ToolOutcome(
        tool_call_id=prepared.tool_call_id,
        tool_name=prepared.tool_name,
        status="success",
        model_payload=model_payload,
        artifacts=artifacts,
        duration_ms=int((time.perf_counter() - started) * 1000),
        normalized_arguments=arguments,
    )


async def execute_tool_call(tool_call: Any, tools: list[ToolDef]) -> ToolOutcome:
    prepared = prepare_tool_call(tool_call, tools)
    if isinstance(prepared, ToolOutcome):
        return prepared
    return await execute_prepared_tool_call(prepared)


async def execute_tool_calls(tool_calls: list[Any], tools: list[ToolDef]) -> list[ToolOutcome]:
    return await asyncio.gather(*(execute_tool_call(call, tools) for call in tool_calls))


def _find_tool(name: str, tools: list[ToolDef]) -> ToolDef | None:
    return next((tool for tool in tools if tool.name == name), None)


def _error(
    call_id: str,
    name: str,
    code: ToolErrorCode,
    message: str,
    retryable: bool,
    started: float,
    *,
    status: ToolStatus = "error",
    arguments: dict[str, Any] | None = None,
) -> ToolOutcome:
    return ToolOutcome(
        tool_call_id=call_id,
        tool_name=name,
        status=status,
        error_code=code,
        error_message=message,
        retryable=retryable,
        duration_ms=int((time.perf_counter() - started) * 1000),
        normalized_arguments=arguments or {},
    )
