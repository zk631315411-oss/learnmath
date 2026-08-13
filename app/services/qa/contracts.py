"""QA 回答模块的数据契约 — 阶段 1 精简版。

这些对象只描述一次问答如何发生，不负责诊断学生长期状态。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class QATurnInput:
    """用户发起的一轮 QA 输入。"""

    user_id: str
    question: str
    input_type: str = "text"
    chat_id: str | None = None
    marker_id: str | None = None
    textbook_id: str | None = None
    page_number: int | None = None
    history: list[dict] | None = None
    teaching_mode: str = "socratic"
    socratic_submode: str = "unclassified"
    image_data: str | None = None
    crop_bbox: dict[str, Any] | None = None
    screenshot_context_id: str | None = None
    token: str | None = None
