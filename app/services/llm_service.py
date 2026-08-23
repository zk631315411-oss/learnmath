"""
大模型服务 — LearnMath 阶段 1。

统一多模态客户端（文字/截图同模型），同时提供 chat_with_tools() 支持 Agent function calling。
"""
from typing import Any

from openai import OpenAI

from app.config import config


class LLMService:
    """统一的 LLM 服务：所有问答都走多模态接口，支持工具调用。"""

    def __init__(self):
        self._client = None
        if config.QA_LLM_API_KEY:
            self._client = OpenAI(
                api_key=config.QA_LLM_API_KEY,
                base_url=config.QA_LLM_API_BASE,
            )
            print(f"[OK] LLM client initialized (model: {config.QA_LLM_MODEL})")
        else:
            print("[WARN] QA_LLM_API_KEY not configured — LLM 问答不可用")

    def is_available(self) -> bool:
        return self._client is not None

    def chat(
        self,
        messages: list[dict],
        *,
        stream: bool = True,
        temperature: float = 0.7,
    ) -> Any:
        """统一聊天接口：text 和 vision 共用。"""
        if not self._client:
            raise RuntimeError("LLM 服务未初始化：请在 .env 中设置 QA_LLM_API_KEY")
        return self._client.chat.completions.create(
            model=config.QA_LLM_MODEL,
            messages=messages,
            stream=stream,
            **({"stream_options": {"include_usage": True}} if stream else {}),
            temperature=temperature,
        )

    def chat_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        *,
        tool_choice: str = "auto",
        temperature: float = 0.3,
        stream: bool = False,
    ) -> Any:
        """支持流式 Function Calling，Agent 可转发思考与答案增量。"""
        if not self._client:
            raise RuntimeError("LLM 服务未初始化")
        extra: dict = {}
        # Thinking-mode models (e.g. qwen3.7-max) reject a forced tool_choice
        # object; the evidence fork's one-shot call must run with thinking off.
        if not stream and isinstance(tool_choice, dict):
            extra["extra_body"] = {"enable_thinking": False}
        return self._client.chat.completions.create(
            model=config.QA_LLM_MODEL,
            messages=messages,
            tools=tools,
            tool_choice=tool_choice,
            stream=stream,
            **({"stream_options": {"include_usage": True}} if stream else {}),
            temperature=temperature,
            **extra,
        )


llm_service = LLMService()
