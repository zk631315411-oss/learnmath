"""问答历史 API — 聊天记录 CRUD 与匿名→登录账号迁移。"""
import json
from typing import List, Literal, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.auth.dependencies import require_user_id
from app.auth.jwt_handler import decode_token

from app.db.chat_history_db import (
    append_follow_up,
    delete_chat_history,
    get_chat_history,
    migrate_user_id,
    save_chat_history,
    update_chat_record,
    update_follow_up,
)

router = APIRouter(prefix="/api/chat", tags=["智能问答"])

# 生成状态机取值（Batch 1 数据契约）
GenerationStatus = Literal["pending", "completed", "interrupted", "cancelled"]


class SourceIn(BaseModel):
    textbook_id: str
    textbook_name: str
    node_id: str
    node_name: str
    chapter: str
    section: str
    source_code: str
    snippet: str


def _serialize_sources(value):
    if value is None or isinstance(value, str):
        return value
    return json.dumps(
        [item.model_dump() if isinstance(item, SourceIn) else item for item in value],
        ensure_ascii=False,
    )


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
    sources: Optional[str | List[SourceIn]] = None
    knowledge_points: Optional[str] = None
    thinking: Optional[str] = None
    tool_activities: Optional[str] = None
    follow_ups: Optional[str] = None
    client_turn_id: Optional[str] = Field(default=None, max_length=64)
    generation_status: Optional[GenerationStatus] = None


class UpdateChatRequest(BaseModel):
    """显式字段语义：只有请求体里出现的字段会被更新；显式传 null 表示清空该字段。"""

    answer: Optional[str] = None
    screenshot_context_id: Optional[str] = None
    thumbnail: Optional[str] = None
    crop_bbox: Optional[str] = None
    thinking: Optional[str] = None
    tool_activities: Optional[str] = None
    sources: Optional[List[SourceIn]] = None
    follow_ups: Optional[str] = None
    generation_status: Optional[GenerationStatus] = None
    generation_error: Optional[str] = None
    client_turn_id: Optional[str] = Field(default=None, max_length=64)
    # 学生自定义对话标题；None=沿用 question 原文，空串视为清除自定义标题
    title: Optional[str] = Field(default=None, max_length=200)


class FollowUpTurnIn(BaseModel):
    """追加追问：发送时先落 pending 项，turn_id 为前端生成的稳定逻辑 ID。"""

    turn_id: str = Field(..., min_length=1, max_length=64)
    question: str = ""
    answer: Optional[str] = None
    thinking: Optional[str] = None
    tool_activities: Optional[List[dict]] = None
    sources: Optional[List[SourceIn]] = None
    image: Optional[str] = None
    crop_bbox: Optional[dict] = None
    screenshot_context_id: Optional[str] = None
    qa_turn_id: Optional[str] = None
    status: Optional[GenerationStatus] = None
    error_message: Optional[str] = None


class FollowUpUpdateIn(BaseModel):
    """按 turn_id 更新追问：同样采用显式字段语义（传 null = 清空）。"""

    question: Optional[str] = None
    answer: Optional[str] = None
    thinking: Optional[str] = None
    tool_activities: Optional[List[dict]] = None
    sources: Optional[List[SourceIn]] = None
    image: Optional[str] = None
    crop_bbox: Optional[dict] = None
    screenshot_context_id: Optional[str] = None
    qa_turn_id: Optional[str] = None
    status: Optional[GenerationStatus] = None
    error_message: Optional[str] = None


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
    """截图/文字提问时前端调用，先写入标记记录（answer 可为空，SSE 完成后回填）。

    无 answer 的新记录落 generation_status=pending；收尾由 PATCH 推进终态。
    """
    chat_id = save_chat_history(
        user_id=req.user_id, question=req.question, answer=req.answer,
        page_number=req.page_number, marker_y_ratio=req.marker_y_ratio,
        marker_type=req.marker_type, thumbnail=req.thumbnail,
        crop_bbox=req.crop_bbox, screenshot_context_id=req.screenshot_context_id,
        sources=_serialize_sources(req.sources), knowledge_points=req.knowledge_points,
        thinking=req.thinking,
        tool_activities=req.tool_activities,
        follow_ups=req.follow_ups or "[]",
        textbook_id=req.textbook_id,
        client_turn_id=req.client_turn_id,
        generation_status=req.generation_status,
    )
    return {"id": chat_id}


@router.patch("/history/{chat_id}")
def update_history(chat_id: str, req: UpdateChatRequest):
    """SSE 完成后更新记录：只更新请求体里显式出现的字段（显式 null = 清空）。"""
    fields = req.model_dump(include=req.model_fields_set)
    if "sources" in fields:
        fields["sources"] = _serialize_sources(fields["sources"])
    # 自定义标题：strip 后为空则视为清除，回到沿用 question 原文
    if "title" in fields:
        title = fields["title"]
        fields["title"] = (title.strip() or None) if isinstance(title, str) else None
    update_chat_record(chat_id, fields)
    return {"status": "ok"}


@router.post("/history/{chat_id}/follow-ups")
def append_follow_up_turn(chat_id: str, req: FollowUpTurnIn):
    """追加一条追问（先落 pending）：按 turn_id 幂等，重复追加返回既有项。"""
    turn = {k: v for k, v in req.model_dump().items() if v is not None}
    turn.setdefault("status", "pending")
    result = append_follow_up(chat_id, turn)
    if result is None:
        raise HTTPException(status_code=404, detail="提问记录不存在")
    return {"status": "ok", "turn": result}


@router.patch("/history/{chat_id}/follow-ups/{turn_id}")
def update_follow_up_turn(chat_id: str, turn_id: str, req: FollowUpUpdateIn):
    """按 chat_id + turn_id 更新单条追问（收尾 completed / interrupted / cancelled）。"""
    result = update_follow_up(chat_id, turn_id, req.model_dump(include=req.model_fields_set))
    if result is None:
        raise HTTPException(status_code=404, detail="提问记录或追问不存在")
    return {"status": "ok", "turn": result}


@router.delete("/history/{chat_id}")
def delete_history(chat_id: str, authorization: Optional[str] = Header(None)):
    user_id = require_user_id(authorization, decoder=decode_token)
    if not delete_chat_history(chat_id, user_id):
        raise HTTPException(status_code=404, detail="提问记录不存在")
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
