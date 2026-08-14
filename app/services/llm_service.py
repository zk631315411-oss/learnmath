"""
大模型服务 — 阶段 1：统一多模态客户端，文字和截图都走同一个 chat 接口。
"""
from typing import Any

from openai import OpenAI

from app.config import config


class LLMService:
    """统一的 LLM 服务：所有问答（文字/截图）都走多模态接口。"""

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


llm_service = LLMService()
