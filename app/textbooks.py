"""Canonical textbook identity — LearnMath 精简版。

只保留 kg_v44.py 需要的 canonical_textbook_id 函数。
"""
from __future__ import annotations

from enum import Enum


class TextbookId(str, Enum):
    GAODAI_SHANG = "gaodai_shang"
    GAODAI_XIA = "gaodai_xia"
    GAOSHU_SHANG = "gaoshu_shang"
    GAOSHU_XIA = "gaoshu_xia"


# Keep the identifiers visible to the agent/tool contract.  The KG stores
# these values on every node, so an invented value such as ``linear_algebra``
# must never be treated as an equivalent alias.
TEXTBOOK_LABELS: dict[str, str] = {
    TextbookId.GAODAI_SHANG.value: "高等代数上册",
    TextbookId.GAODAI_XIA.value: "高等代数下册",
    TextbookId.GAOSHU_SHANG.value: "高等数学上册",
    TextbookId.GAOSHU_XIA.value: "高等数学下册",
}


def textbook_scope_description(textbook_id: str | None) -> str:
    """Return a model-facing description of the backend-bound KG scope."""
    clean = (textbook_id or "").strip().lower()
    if not clean:
        return "当前未绑定单一教材，检索会在全部已配置教材范围内进行。"
    label = TEXTBOOK_LABELS.get(clean)
    if label:
        return f"当前绑定教材：{clean}（{label}）。"
    return (
        f"当前请求携带的教材代号是 {clean}，它不是已注册的教材代号；"
        "在此范围内匹配不到节点时必须报告教材范围不匹配。"
    )


_CANONICAL_MAP: dict[str, TextbookId] = {
    "gaodai_shang": TextbookId.GAODAI_SHANG,
    "gaodai_xia": TextbookId.GAODAI_XIA,
    "gaoshu_shang": TextbookId.GAOSHU_SHANG,
    "gaoshu_xia": TextbookId.GAOSHU_XIA,
}


def canonical_textbook_id(textbook_id: str) -> TextbookId:
    """标准化教材 ID，未知值返回默认（gaodai_shang）。"""
    clean = (textbook_id or "").strip().lower()
    return _CANONICAL_MAP.get(clean, TextbookId.GAODAI_SHANG)
