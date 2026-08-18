"""问答历史 API — 聊天记录 CRUD 与匿名→登录账号迁移。"""
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.auth.jwt_handler import decode_token

from app.db.chat_history_db import (
    delete_chat_history,
    get_chat_history,
    migrate_user_id,
    save_chat_history,
    update_chat_answer,
)

router = APIRouter(prefix="/api/chat", tags=["智能问答"])


class SaveChatRequest(BaseModel):
    user_id: str
    question: str
    answer: Optional[str] = None
    page_number: Optional[int] = None
    textbook_id: Optional[str] = None
    marker_y_ratio: Optional[float] = None
    marker_type: str = "screenshot"
    thumbnail: Optional[str] = None
    crop_bbox: Optional[str] = None
    screenshot_context_id: Optional[str] = None
    sources: Optional[str] = None
    knowledge_points: Optional[str] = None
    thinking: Optional[str] = None
    tool_activities: Optional[str] = None
    follow_ups: Optional[str] = None


class UpdateChatRequest(BaseModel):
    answer: Optional[str] = None
    screenshot_context_id: Optional[str] = None
    thumbnail: Optional[str] = None
    crop_bbox: Optional[str] = None
    thinking: Optional[str] = None
    tool_activities: Optional[str] = None
    follow_ups: Optional[str] = None


class MigrateChatRequest(BaseModel):
    old_token: str


@router.get("/history/{user_id}")
def get_history(user_id: str, limit: int = 50, page: Optional[int] = None,
                id: Optional[str] = None, textbook_id: Optional[str] = None):
    """查询历史；textbook_id 可选，传入时按教材过滤（老数据 NULL 仍全部可见）。"""
    return get_chat_history(user_id, limit=limit, page_number=page, chat_id=id,
                            textbook_id=textbook_id)


@router.post("/history")
def create_history(req: SaveChatRequest):
    """截图/文字提问时前端调用，先写入标记记录（answer 可为空，SSE 完成后回填）。"""
    chat_id = save_chat_history(
        user_id=req.user_id, question=req.question, answer=req.answer,
        page_number=req.page_number, marker_y_ratio=req.marker_y_ratio,
        marker_type=req.marker_type, thumbnail=req.thumbnail,
        crop_bbox=req.crop_bbox, screenshot_context_id=req.screenshot_context_id,
        sources=req.sources, knowledge_points=req.knowledge_points,
        thinking=req.thinking,
        tool_activities=req.tool_activities,
        follow_ups=req.follow_ups or "[]",
        textbook_id=req.textbook_id,
    )
    return {"id": chat_id}


@router.patch("/history/{chat_id}")
def update_history(chat_id: str, req: UpdateChatRequest):
    """SSE 完成后更新记录：answer / screenshot_context_id 等字段可分别更新。"""
    update_chat_answer(
        chat_id,
        answer=req.answer,
        screenshot_context_id=req.screenshot_context_id,
        thumbnail=req.thumbnail,
        crop_bbox=req.crop_bbox,
        thinking=req.thinking,
        tool_activities=req.tool_activities,
        follow_ups=req.follow_ups,
    )
    return {"status": "ok"}


@router.delete("/history/{chat_id}")
def delete_history(chat_id: str):
    delete_chat_history(chat_id)
    return {"status": "deleted"}


@router.post("/migrate")
def migrate_markers(req: MigrateChatRequest, authorization: Optional[str] = Header(None)):
    """由新旧 token 推导双方身份后，原子迁移聊天记录与 evidence。"""
    parts = (authorization or "").split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="未登录或token无效")
    try:
        old_user_id = decode_token(req.old_token).get("user_id")
        new_user_id = decode_token(parts[1]).get("user_id")
    except Exception as exc:
        raise HTTPException(status_code=401, detail="未登录或token无效") from exc
    if not old_user_id or not new_user_id:
        raise HTTPException(status_code=401, detail="未登录或token无效")
    count = migrate_user_id(old_user_id, new_user_id)
    return {"status": "ok", "migrated": count}
