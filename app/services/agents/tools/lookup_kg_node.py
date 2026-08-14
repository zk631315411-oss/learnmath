"""Knowledge graph lookup through a validated agent tool."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.db.kg_v44 import find_node, related_nodes
from app.services.agents.tool_def import ToolDef


class LookupKGNodeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    concept_name: str = Field(min_length=1, max_length=120)


def _lookup_kg_node_impl(concept_name: str) -> dict:
    node = find_node(concept_name)
    if not node:
        return {"found": False, "message": f"未找到概念 '{concept_name}'"}
    support_nodes, lookahead_nodes = related_nodes(node.get("name", concept_name), limit=10)
    return {
        "found": True,
        "node": {
            "name": node.get("name"),
            "type": node.get("type") or node.get("node_type"),
            "source_code": node.get("source_code"),
            "evidence_span": node.get("evidence_span"),
        },
        "support_nodes": [
            {"name": item.get("name"), "type": item.get("type"), "rel_type": item.get("rel_type")}
            for item in (support_nodes or []) if item.get("name")
        ],
        "lookahead_nodes": [
            {"name": item.get("name"), "type": item.get("type"), "rel_type": item.get("rel_type")}
            for item in (lookahead_nodes or []) if item.get("name")
        ],
    }


lookup_kg_node_tool = ToolDef(
    name="lookup_kg_node",
    display_name="查询知识图谱",
    description="查询知识图谱中的概念定义、教材证据和前后置关系。",
    input_model=LookupKGNodeInput,
    execute=_lookup_kg_node_impl,
)
