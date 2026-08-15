"""QA 流式输出辅助函数 — 统一 SSE 事件形状，前端按 event 字段分派。"""

from __future__ import annotations

import json


def sse_event(event: str, data: dict) -> dict:
    """生成 EventSourceResponse 可直接消费的事件。"""
    return {"event": event, "data": json.dumps(data, ensure_ascii=False)}


def sse_stage(stage: str, text: str) -> dict:
    return sse_event("stage", {"stage": stage, "text": text})


def sse_text(text: str) -> dict:
    return sse_event("content", {"text": text})


def sse_thinking(text: str) -> dict:
    return sse_event("thinking", {"text": text})


def sse_tool_call(data: dict) -> dict:
    return sse_event("tool_call", data)


def sse_tool_result(data: dict) -> dict:
    return sse_event("tool_result", data)


def sse_done(**data) -> dict:
    return sse_event("done", data)


def sse_error(error: str) -> dict:
    return sse_event("error", {"error": error})
