"""Context-bound KG retrieval tool used by the teaching agent."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db.kg_v44 import RetrievalFocus, retrieve_kg_context
from app.services.agents.tool_def import ToolDef
from app.textbooks import TEXTBOOK_LABELS, textbook_scope_description


class RetrieveKGContextInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(
        min_length=1,
        max_length=300,
        description=(
            "用于定位教材知识点的简洁数学查询。文字题提取核心概念；截图题先读图，"
            "再把题目所考查的概念、定理或方法写成可检索文本。"
        ),
    )
    node_id: str | None = Field(
        default=None,
        max_length=160,
        description=(
            "仅在上一次返回 ambiguous 时填写，从候选中选择稳定 node_id 以展开该节点。"
        ),
    )
    focus: list[RetrievalFocus] = Field(
        default_factory=lambda: ["overview"],
        min_length=1,
        max_length=2,
        description=(
            "教学检索方向，最多两个且不得重复：prerequisites=明确前置，"
            "successors=明确后置，supporting=支撑知识，applications=应用扩展，"
            "rules=判定条件与结论，structure=层级/组成/并列，overview=各方向概览。"
            "overview 必须单独使用；省略时默认为 overview。"
        ),
    )

    @field_validator("focus")
    @classmethod
    def validate_focus_combination(cls, value: list[RetrievalFocus]) -> list[RetrievalFocus]:
        if len(set(value)) != len(value):
            raise ValueError("focus values must be unique")
        if "overview" in value and len(value) > 1:
            raise ValueError("overview cannot be combined with another focus")
        return value


def build_retrieve_kg_context_tool(
    *,
    textbook_id: str | None,
    page_number: int | None,
) -> ToolDef:
    """Bind non-model scope fields into a per-turn read-only tool."""

    def execute(
        query: str,
        node_id: str | None = None,
        focus: list[RetrievalFocus] | None = None,
    ) -> dict:
        return retrieve_kg_context(
            query,
            node_id=node_id,
            focus=focus,
            textbook_id=textbook_id,
            page_number=page_number,
        )

    return ToolDef(
        name="retrieve_kg_context",
        display_name="检索教材知识图谱",
        description=(
            "按需检索当前教材知识图谱。可查询概念/定理/公式/方法/题型的定义与教材证据。"
            f"{textbook_scope_description(textbook_id)}"
            "教材范围由后端绑定，Kimi 不需要也不能在工具参数中填写 textbook_id；"
            f"已注册教材代号只有：{', '.join(TEXTBOOK_LABELS)}。"
            "不要使用 linear_algebra 等未注册代号，也不要把不同教材的同名节点混在一起。"
            "并通过 focus 选择明确前置、明确后置、支撑知识、应用扩展、结构关系或 RuleCase。"
            "核心节点与教材证据始终返回；EQUATIVE 仅表示同层并列，不代表数学等价。"
            "返回 resolved 时依据 KG 教学；ambiguous 时结合题意选择候选 node_id 再调用；"
            "消歧调用应重复原 focus；not_found 时可继续一般数学回答，但必须明确本轮没有 KG 依据。"
        ),
        input_model=RetrieveKGContextInput,
        execute=execute,
        present_result=_present_retrieve_result,
        max_calls_per_round=3,
        max_calls_per_turn=3,
        timeout_seconds=30.0,
        kind="read_only",
    )


def _present_retrieve_result(result: dict) -> dict:
    """Keep full evidence model-only; persist a compact user-facing activity."""
    status = str(result.get("status") or "not_found")
    public = {
        "status": status,
        "kg_basis_available": bool(result.get("kg_basis_available")),
        "message": result.get("message"),
        "requested_focus": result.get("requested_focus") or [],
        "retrieved_focus": result.get("retrieved_focus") or [],
        "empty_focus": result.get("empty_focus") or [],
        "focus_stats": result.get("focus_stats") or {},
    }
    if status == "ambiguous":
        public["candidates"] = [
            {
                "node_id": item.get("node_id"),
                "name": item.get("name"),
                "type": item.get("type"),
                "match_type": item.get("match_type"),
            }
            for item in (result.get("candidates") or [])
            if isinstance(item, dict)
        ]
        return public
    if status != "resolved":
        return public

    node = result.get("selected_node") or {}
    public["selected_node"] = {
        "node_id": node.get("node_id"),
        "name": node.get("name"),
        "type": node.get("type"),
        "match_type": node.get("match_type"),
        "source_code": node.get("source_code"),
    }
    relationships = result.get("relationships") or {}
    public["relationships"] = {
        group: [
            {
                "node_id": (item.get("node") or {}).get("node_id"),
                "name": (item.get("node") or {}).get("name"),
                "type": (item.get("node") or {}).get("type"),
                "relationship_type": item.get("relationship_type"),
                "direction": item.get("direction"),
            }
            for item in (relationships.get(group) or [])
            if isinstance(item, dict)
        ]
        for group in (
            "explicit_prerequisites",
            "explicit_successors",
            "supporting_knowledge",
            "applications_and_extensions",
            "structural_context",
        )
        if group in relationships
    }
    if "rule_cases" in result:
        public["rule_case_count"] = len(result.get("rule_cases") or [])
    return public
