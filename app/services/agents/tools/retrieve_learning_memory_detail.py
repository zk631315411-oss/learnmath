"""Bounded detail lookup for refs returned by the current memory index."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.services.agents.tool_def import ToolDef
from app.services.learning.learning_memory_service import (
    MAX_DETAIL_REFS,
    retrieve_learning_memory_detail,
)


class MemoryRefInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evidence_id: str = Field(min_length=1)
    node_id: str = Field(min_length=1)
    textbook_id: str = Field(min_length=1)


class RetrieveLearningMemoryDetailInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    memory_refs: list[MemoryRefInput] = Field(
        min_length=1,
        max_length=MAX_DETAIL_REFS,
        description="仅允许本轮 memory index 返回的 evidence 引用，最多 3 条。",
    )


def build_retrieve_learning_memory_detail_tool(
    *,
    user_id: str,
    textbook_id: str | None,
) -> ToolDef:
    bound_user = str(user_id or "").strip()
    bound_book = str(textbook_id or "").strip()

    def execute(memory_refs: list[dict]) -> dict:
        return retrieve_learning_memory_detail(
            bound_user,
            bound_book,
            memory_refs,
        )

    return ToolDef(
        name="retrieve_learning_memory_detail",
        display_name="读取学习记忆详情",
        description=(
            "读取本轮 memory index 返回的最多 3 条学习记忆详情。"
            "后端绑定用户和教材，只返回学生问题与必要的可见教师回答摘录；"
            "不得读取 thinking、tool_activities 或其他用户数据。"
        ),
        input_model=RetrieveLearningMemoryDetailInput,
        execute=execute,
        present_result=_present_result,
        max_calls_per_round=1,
        max_calls_per_turn=1,
        timeout_seconds=5.0,
        kind="read_only",
    )


def _present_result(result: dict) -> dict:
    return {
        "status": result.get("status"),
        "available": result.get("available"),
        "count": len(result.get("observations") or []),
    }
