"""Router 层公共辅助：请求参数清洗与校验。

鉴权统一走 app.auth.dependencies.require_user_id；
教材解析这里收敛「清洗 + 目录校验 + 503/400」三连写法。
"""
from __future__ import annotations

from fastapi import HTTPException

from app.services.learning.catalog import get_catalog_entry
from app.textbooks import normalize_textbook_id


def resolve_textbook(textbook_id: str) -> str:
    """清洗教材 ID 并校验其已在学习目录中，返回清洗值。

    目录未生成抛 503，未注册教材抛 400 —— 与 learning_progress /
    learner_model 两路由此前的内联行为一致。
    """
    clean = normalize_textbook_id(textbook_id)
    try:
        entry = get_catalog_entry(clean)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="学习目录尚未生成") from exc
    if not entry:
        raise HTTPException(status_code=400, detail="未知教材")
    return clean
