"""QA 回答模块 — 统一多模态问答。"""

from app.services.qa.answer_service import answer_turn
from app.services.qa.contracts import QATurnInput
from app.services.qa.prompt_builder import build_qa_prompt

__all__ = [
    "QATurnInput",
    "answer_turn",
    "build_qa_prompt",
]
