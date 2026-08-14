"""Agent infrastructure — LearnMath 阶段 1。

精简版：只保留 QA Agent（带 KG 工具调用）。
"""
from app.services.agents.base import BaseAgent
from app.services.agents.tool_def import ToolDef
from app.services.agents.tool_runtime import ToolRuntime, ToolRuntimeConfig, ToolRuntimeContext
from app.services.agents.registry import register, get_agent, list_agents

__all__ = [
    "BaseAgent", "ToolDef", "ToolRuntime", "ToolRuntimeConfig", "ToolRuntimeContext",
    "register", "get_agent", "list_agents",
]
