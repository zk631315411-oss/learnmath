"""Stage-one tools for the unified text and screenshot teaching agent."""

from __future__ import annotations

from app.services.agents.tool_def import ToolDef


def get_qa_tool_defs(
    *,
    textbook_id: str | None = None,
    page_number: int | None = None,
    user_id: str | None = None,
    allowed_node_ids: set[str] | None = None,
) -> list[ToolDef]:
    from app.services.agents.tools.retrieve_kg_context import build_retrieve_kg_context_tool

    tools = [
        build_retrieve_kg_context_tool(
            textbook_id=textbook_id,
            page_number=page_number,
        ),
    ]
    # The memory tools are read-only and scoped to the authenticated user,
    # current textbook, and KG-resolved nodes for this turn.
    from app.config import config
    if config.LEARNER_MODEL_ENABLED:
        from app.services.agents.tools.retrieve_learning_memory_index import (
            build_retrieve_learning_memory_index_tool,
        )
        from app.services.agents.tools.retrieve_learning_memory_detail import (
            build_retrieve_learning_memory_detail_tool,
        )
        tools.append(build_retrieve_learning_memory_index_tool(
            user_id=str(user_id or ""),
            textbook_id=textbook_id,
            allowed_node_ids=allowed_node_ids,
        ))
        tools.append(build_retrieve_learning_memory_detail_tool(
            user_id=str(user_id or ""),
            textbook_id=textbook_id,
        ))
    return tools


__all__ = ["get_qa_tool_defs"]
