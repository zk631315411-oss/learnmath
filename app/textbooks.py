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
