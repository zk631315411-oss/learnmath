"""QA 回答模块 — Agent 架构版（阶段 1）。"""

from app.services.qa.answer_service import answer_turn, answer_turn_with_tools
from app.services.qa.contracts import QATurnInput
from app.services.qa.prompt_builder import build_qa_prompt

__all__ = [
    "QATurnInput",
    "answer_turn",
    "answer_turn_with_tools",
    "build_qa_prompt",
]
