from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator


# === 用户认证相关模型 ===

class UserRegister(BaseModel):
    username: str = Field(..., min_length=1, max_length=50, pattern=r'^[a-zA-Z0-9_一-鿿]+$')
    password: str = Field(..., min_length=1, max_length=128)
    device_id: str


class UserLogin(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class UserProfileResponse(BaseModel):
    id: str
    username: str
    is_anonymous: bool = False
    grade: Optional[str] = ""
    weak_points: List[str] = []
    strong_points: List[str] = []
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    username: str
    is_anonymous: bool = False


# === 公式转写相关模型 ===

class FormulaConvertRequest(BaseModel):
    description: str = Field(..., min_length=1, max_length=500)
    preferred_display: Literal["auto", "inline", "block"] = "auto"

    @field_validator("description")
    @classmethod
    def description_must_have_content(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("description cannot be blank")
        return value


class FormulaConvertResponse(BaseModel):
    latex: str
    display_mode: Literal["inline", "block"]


class RecognizedTextBlock(BaseModel):
    type: Literal["text"]
    text: str = Field(..., min_length=1, max_length=500)
    bbox: Optional[List[int]] = None


class RecognizedFormulaBlock(BaseModel):
    type: Literal["formula"]
    latex: str = Field(..., min_length=1, max_length=2048)
    display_mode: Literal["inline", "block"]
    bbox: Optional[List[int]] = None


class FormulaRecognizeContentResponse(BaseModel):
    blocks: List[RecognizedTextBlock | RecognizedFormulaBlock] = Field(..., max_length=50)
    warnings: List[str] = Field(default_factory=list, max_length=10)


# === 题目答疑相关模型 ===

class QARequest(BaseModel):
    """/api/qa/solve-stream 的 JSON payload（通过 multipart Form 的 payload 字段传入）。"""
    user_id: Optional[str] = None
    device_id: Optional[str] = None
    token: Optional[str] = None  # JWT token（优先使用）
    question: str
    teaching_mode: Optional[str] = "socratic"  # "socratic" 或 "direct"
    socratic_submode: Optional[str] = "unclassified"  # "preview"|"exam_review"|"connected_review"|"unclassified"
    chat_id: Optional[str] = None  # 关联 chat_history 记录（标记更新用）
    marker_id: Optional[str] = None  # 前端页码徽标 ID（只读上下文绑定）
    page_id: Optional[str] = None  # 兼容前端可能传入的页码徽标 ID 命名
    textbook_id: Optional[str] = None
    page_number: Optional[int] = None  # PDF 物理页码（阶段 2 用于获取章节上下文）
    history: Optional[List[dict]] = None  # 对话历史 [{"user": "...", "assistant": "..."}]
    crop_bbox: Optional[dict] = None  # 截图区域在 PDF 页面中的相对坐标
    screenshot_context_id: Optional[str] = None  # 已缓存的截图上下文 ID
    # 前端生成的稳定逻辑 turn ID：贯穿 pending 落库、重试幂等与 evidence 去重
    client_turn_id: Optional[str] = Field(default=None, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
