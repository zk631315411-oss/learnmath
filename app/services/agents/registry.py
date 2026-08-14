"""Agent 注册表，管理所有已注册的 Agent 实例。

提供注册、查询、列表、清空四种操作，
路由层通过注册表获取 Agent 实例，无需直接 import 具体实现。
"""

from __future__ import annotations

from app.services.agents.base import BaseAgent

AGENT_REGISTRY: dict[str, BaseAgent] = {}


def register(agent: BaseAgent) -> None:
    """注册 Agent，同名时覆盖旧实例。"""
    AGENT_REGISTRY[agent.name] = agent


def get_agent(name: str) -> BaseAgent:
    """按名称获取 Agent 实例。找不到时 raise KeyError。"""
    if name not in AGENT_REGISTRY:
        raise KeyError(f"Agent '{name}' 未注册，当前已注册: {list(AGENT_REGISTRY.keys())}")
    return AGENT_REGISTRY[name]


def list_agents() -> list[dict]:
    """返回所有已注册 Agent 的摘要信息。"""
    return [{"name": agent.name, "description": agent.description} for agent in AGENT_REGISTRY.values()]


def clear() -> None:
    """清空注册表，主要用于测试场景。"""
    AGENT_REGISTRY.clear()