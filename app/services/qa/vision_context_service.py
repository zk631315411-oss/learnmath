"""截图/视觉 QA 的上下文准备 — 阶段 1 精简版。

只负责截图上下文缓存的读写与判定，不做 PDF 裁剪、不做教材定位。
"""

from __future__ import annotations

import hashlib

from app.config import config
from app.db.screenshot_context_cache_db import (
    find_screenshot_context_cache,
    get_screenshot_context_cache,
    save_screenshot_context_cache,
    update_screenshot_context_cache,
)
from app.services.qa.contracts import QATurnInput


def image_data_hash(image_data: str | None) -> str:
    """以 data URL 的 base64 部分做 sha256 指纹，作为截图去重缓存键。"""
    if not image_data:
        return ""
    if "," in image_data:
        image_data = image_data.split(",", 1)[1]
    return hashlib.sha256(image_data.encode("utf-8")).hexdigest()


def _get_valid_cache(turn_input: QATurnInput) -> dict | None:
    """读取前端显式指定的截图上下文缓存（要求属于该用户）。"""
    if not turn_input.screenshot_context_id:
        return None
    try:
        return get_screenshot_context_cache(turn_input.screenshot_context_id, turn_input.user_id)
    except Exception as exc:
        # 缓存读取失败不阻断问答，按无缓存处理即可
        print(f"[vision] cache read failed: {exc}")
        return None


def has_screenshot_context(turn_input: QATurnInput) -> bool:
    """判断本轮请求是否应该走截图/视觉 QA。"""
    if turn_input.image_data:
        return True
    if turn_input.crop_bbox and turn_input.page_number:
        return True
    return _get_valid_cache(turn_input) is not None


def prepare_screenshot_context(turn_input: QATurnInput) -> dict:
    """整理截图上下文：优先复用已有缓存，否则新建一条记录。

    阶段 1 的缓存指纹只到 image_hash + 页码粒度，
    教材定位 / 全文哈希字段留空，待阶段 2 扩展。
    """
    img_hash = image_data_hash(turn_input.image_data)
    cached = _get_valid_cache(turn_input)

    if not cached and img_hash:
        try:
            cached = find_screenshot_context_cache(
                turn_input.user_id,
                img_hash,
                turn_input.textbook_id or "",
                turn_input.page_number or 0,
                "",
                "",
            )
        except Exception as exc:
            # 查询失败退化为新建缓存，不让截图问答中断
            print(f"[vision] cache lookup failed: {exc}")
            cached = None

    if cached:
        return {
            "cache_id": cached["id"],
            "image_hash": img_hash or cached.get("image_hash") or "",
            "reused_cache": True,
            "crop_bbox": turn_input.crop_bbox,
        }

    cache_id = save_screenshot_context_cache(
        user_id=turn_input.user_id,
        image_hash=img_hash,
        textbook_id=turn_input.textbook_id or "",
        page_number=turn_input.page_number or 0,
        crop_bbox=turn_input.crop_bbox,
        crop_bbox_hash="",
        full_context_hash="",
        pdf_crop_path=None,
        md_match_status=None,
        md_match_confidence=None,
        md_match_text=None,
        locator_signals=None,
        vision_model=config.QA_VL_MODEL,
    )
    return {
        "cache_id": cache_id,
        "image_hash": img_hash,
        "reused_cache": False,
        "crop_bbox": turn_input.crop_bbox,
    }


def update_vision_summary(cache_id: str, summary: str) -> None:
    """把本轮 VL 回答摘要写回缓存，供后续会话快速了解该截图。"""
    try:
        update_screenshot_context_cache(cache_id, vision_summary=summary)
    except Exception as exc:
        # 缓存更新失败不影响主流程，只记录原因
        print(f"[vision] cache update failed: {exc}")
