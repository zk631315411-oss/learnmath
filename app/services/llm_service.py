"""
大模型服务 — 阶段 1 精简版：只保留 QA 文字流式与 VL 多模态两种能力。
"""
from typing import Any

from openai import OpenAI, AsyncOpenAI

from app.config import config


class LLMService:
    """统一的 LLM 服务：文字问答走 qa_client，截图问答走同一客户端的 VL 模型。"""

    def __init__(self):
        # QA 文字流式用的同步客户端（OpenAI 兼容协议）
        self.qa_client = None
        if config.QA_LLM_API_KEY:
            self.qa_client = OpenAI(
                api_key=config.QA_LLM_API_KEY,
                base_url=config.QA_LLM_API_BASE
            )
            print(f"[OK] QA LLM client initialized (model: {config.QA_LLM_MODEL})")
        else:
            print("[WARN] QA_LLM_API_KEY not configured")

        # 异步客户端：为后续非流式场景预留，不在事件循环里做阻塞调用
        self.qa_async = None
        if config.QA_LLM_API_KEY:
            self.qa_async = AsyncOpenAI(
                api_key=config.QA_LLM_API_KEY,
                base_url=config.QA_LLM_API_BASE,
            )

    def is_qa_available(self) -> bool:
        return self.qa_client is not None

    def stream_chat(self, messages: list, model: str = None, enable_thinking: bool = True):
        """流式调用（QA 用）：Qwen3 Thinking 系列模型通过 extra_body 开关思考过程。"""
        if not self.qa_client:
            raise RuntimeError("QA LLM 服务未初始化")

        extra_body = {}
        if enable_thinking:
            extra_body["enable_thinking"] = True

        return self.qa_client.chat.completions.create(
            model=model or config.QA_LLM_MODEL,
            messages=messages,
            stream=True,
            stream_options={"include_usage": True},
            temperature=0.7,
            extra_body=extra_body if extra_body else None,
        )

    def vision_chat(
        self,
        image_data: str,
        prompt: str,
        *,
        stream: bool = False,
        temperature: float = 0.1,
    ) -> Any:
        """调用多模态模型：图 + 文混合输入，用于截图问答。"""
        if not self.qa_client:
            raise RuntimeError("QA LLM service is not initialized")
        from app.services.image_processing import normalize_model_data_url

        normalized_image = normalize_model_data_url(image_data)
        return self.qa_client.chat.completions.create(
            model=config.QA_VL_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": normalized_image}},
                    {"type": "text", "text": prompt},
                ],
            }],
            stream=stream,
            temperature=temperature,
        )


llm_service = LLMService()
