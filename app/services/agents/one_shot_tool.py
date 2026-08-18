"""Execute exactly one provider-selected call to one forced tool."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from app.services.agents.tool_def import ToolDef
from app.services.agents.tool_executor import ToolOutcome, execute_tool_call


ModelCall = Callable[..., Awaitable[Any]]


@dataclass(frozen=True)
class OneShotToolResult:
    outcome: ToolOutcome | None = None
    error_code: str | None = None
    error_message: str | None = None


async def run_one_shot_tool(
    *,
    messages: list[dict[str, Any]],
    tool: ToolDef,
    model_call: ModelCall,
) -> OneShotToolResult:
    """Call the provider once and execute its single forced tool call."""
    response = await model_call(
        messages=messages,
        tools=[tool.to_openai_tool()],
        tool_choice={"type": "function", "function": {"name": tool.name}},
    )
    choices = list(getattr(response, "choices", None) or [])
    if not choices:
        return OneShotToolResult(
            error_code="missing_choice",
            error_message="证据分叉没有返回模型 choice",
        )

    message = getattr(choices[0], "message", None)
    calls = list(getattr(message, "tool_calls", None) or [])
    if len(calls) != 1:
        return OneShotToolResult(
            error_code="invalid_tool_call_count",
            error_message=f"证据分叉应返回 1 个工具调用，实际为 {len(calls)} 个",
        )

    outcome = await execute_tool_call(calls[0], [tool])
    return OneShotToolResult(outcome=outcome)
