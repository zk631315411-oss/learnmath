"""QA 回答模块的数据契约 — 统一多模态版。

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
    client_turn_id: str | None = None  # 前端稳定逻辑 turn ID（重试幂等/evidence 去重）
