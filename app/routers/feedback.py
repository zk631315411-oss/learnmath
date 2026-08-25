"""Internal test feedback endpoint with append-only daily JSON storage."""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from threading import Lock
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, Field

from app.auth.dependencies import user_id_from_token
from app.auth.jwt_handler import decode_token
from app.config import config


class FeedbackSubmission(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    most_used_feature: str = Field(default="", max_length=100)
    disappointing_feature: str = Field(default="", max_length=100)
    disappointing_reason: str = Field(default="", max_length=1000)
    problem_description: str = Field(default="", max_length=2000)
    recommend: str = Field(default="", max_length=30)
    suggestion: str = Field(default="", max_length=2000)
    contact: str = Field(default="", max_length=200)
    page_url: str = Field(default="", max_length=2048)


router = APIRouter(prefix="/api/feedback", tags=["内测反馈"])
_feedback_lock = Lock()


def _feedback_path(now: datetime) -> os.PathLike[str]:
    directory = config.DATA_DIR / "feedback"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{now.date().isoformat()}.json"


def _append_feedback(path: os.PathLike[str], item: dict) -> None:
    with _feedback_lock:
        records: list[dict] = []
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    loaded = json.load(handle)
                if isinstance(loaded, list):
                    records = loaded
            except (OSError, ValueError):
                # Preserve a malformed file rather than silently overwriting it.
                raise RuntimeError("反馈存储文件不可读")
        records.append(item)
        directory = os.path.dirname(os.fspath(path))
        fd, temporary = tempfile.mkstemp(prefix=".feedback-", suffix=".tmp", dir=directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(records, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


@router.post("")
def submit_feedback(
    payload: FeedbackSubmission,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    now = datetime.now(timezone.utc)
    user_id = user_id_from_token(authorization, decoder=decode_token)
    item = {
        "id": str(uuid4()),
        "user_id": user_id,
        "timestamp": now.isoformat(),
        "user_agent": (request.headers.get("user-agent") or "")[:512],
        **payload.model_dump(),
    }
    try:
        _append_feedback(_feedback_path(now), item)
    except RuntimeError:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="反馈暂时无法保存")
    return {"status": "ok", "id": item["id"]}
