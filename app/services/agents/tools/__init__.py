"""Agent tool implementations — LearnMath 阶段 1 工具集。

阶段 1 只启用 lookup_kg_node（查知识图谱）。
search_textbook / verify_math / create_math_visualization 留到阶段 2 再加。
"""
from __future__ import annotations

from app.services.agents.tool_def import ToolDef


def get_qa_tool_defs() -> list[ToolDef]:
    from app.services.agents.tools.lookup_kg_node import lookup_kg_node_tool
    return [
        lookup_kg_node_tool,
    ]


__all__ = ["get_qa_tool_defs"]
