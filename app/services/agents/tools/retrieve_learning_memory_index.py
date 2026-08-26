"""Read-only node learning-memory index for the teaching Agent."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services.agents.tool_def import ToolDef
from app.services.learning.learning_memory_service import (
    MAX_TARGET_NODES,
    retrieve_learning_memory_index,
)


class RetrieveLearningMemoryIndexInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_ids: list[str] = Field(
        min_length=1,
        max_length=MAX_TARGET_NODES,
        description="当前轮已由 KG 定位的目标 node_id，最多 3 个。",
    )

    @field_validator("node_ids")
    @classmethod
    def unique_node_ids(cls, value: list[str]) -> list[str]:
        cleaned = [str(item).strip() for item in value if str(item).strip()]
        if len(cleaned) != len(set(cleaned)):
            raise ValueError("node_ids 不得重复")
        return cleaned


def build_retrieve_learning_memory_index_tool(
    *,
    user_id: str,
    textbook_id: str | None,
    allowed_node_ids: set[str] | None = None,
) -> ToolDef:
    bound_user = str(user_id or "").strip()
    bound_book = str(textbook_id or "").strip()
    resolved_ids = allowed_node_ids

    def execute(node_ids: list[str]) -> dict:
        if resolved_ids is not None:
            requested = {str(item).strip() for item in node_ids}
            if not requested.issubset(resolved_ids):
                return {
                    "status": "invalid_scope",
                    "reason": "nodes_must_be_resolved_by_kg_in_this_turn",
                    "nodes": [],
                }
        return retrieve_learning_memory_index(
            bound_user,
            bound_book,
            node_ids,
            allowed_node_ids=resolved_ids,
        )

    return ToolDef(
        name="retrieve_learning_memory_index",
        display_name="读取学习记忆索引",
        description=(
            "读取当前学生在当前教材内、已由 KG 定位节点的学习记忆索引。"
            "返回节点观察摘要、最近观察、mastery_view 和有限教学提示；"
            "最多 3 个目标节点；沿明确 PREREQUISITE_OF 最多两跳，每跳最多 5 个前置（总计最多 10 个）。"
            "这是只读工具，不能修改 evidence 或学生模型。"
        ),
        input_model=RetrieveLearningMemoryIndexInput,
        execute=execute,
        present_result=_present_result,
        max_calls_per_round=1,
        # 允许修正参数后重试 1 次：首次调用若混入未 resolve 节点被 scope 拒绝，
        # 模型应能用已 resolve 的子集再试一次，而非整轮失去记忆检索。
        max_calls_per_turn=2,
        timeout_seconds=5.0,
        kind="read_only",
    )


def _present_result(result: dict) -> dict:
    """Keep the internal memory payload out of student-visible activities."""
    return {
        "status": result.get("status"),
        "available": result.get("available"),
        "node_count": len(result.get("nodes") or []),
    }
