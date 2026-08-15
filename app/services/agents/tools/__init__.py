"""Stage-one tools for the unified text and screenshot teaching agent."""

from __future__ import annotations

from app.services.agents.tool_def import ToolDef


def get_qa_tool_defs(
    *,
    textbook_id: str | None = None,
    page_number: int | None = None,
) -> list[ToolDef]:
    from app.services.agents.tools.retrieve_kg_context import build_retrieve_kg_context_tool

    return [
        build_retrieve_kg_context_tool(
            textbook_id=textbook_id,
            page_number=page_number,
        )
    ]


__all__ = ["get_qa_tool_defs"]
