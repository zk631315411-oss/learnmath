"""Agent 统一抽象基类。

所有 Agent 必须继承 BaseAgent 并实现 run() 方法，
以提供统一的流式事件接口和 Function Calling 扩展点。
"""

from __future__ import annotations

import abc
from typing import Any, AsyncIterator


class BaseAgent(abc.ABC):
    """Agent 抽象基类，定义统一接口和预留扩展点。"""

    name: str = ""
    description: str = ""

    @abc.abstractmethod
    async def run(self, input: Any, stream: bool = True) -> AsyncIterator[dict]:
        """统一入口，返回 SSE 事件流。"""
        ...

    def get_tools(self) -> list[dict]:
        """预留 Function Calling 扩展，当前返回空列表。"""
        return []