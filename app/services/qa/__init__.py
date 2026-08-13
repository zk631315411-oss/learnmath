"""QA 回答模块 — 阶段 1：文本与截图问答。"""

from app.services.qa.answer_service import answer_turn
from app.services.qa.contracts import QATurnInput
from app.services.qa.prompt_builder import build_qa_prompt
from app.services.qa.vision_context_service import has_screenshot_context

__all__ = [
    "QATurnInput",
    "answer_turn",
    "build_qa_prompt",
    "has_screenshot_context",
]
