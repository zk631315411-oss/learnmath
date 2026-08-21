"""题目答疑 API — 阶段 1：/solve-stream 流式问答（SSE），支持文字与截图两种输入。"""
import asyncio
import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import ValidationError
from sse_starlette.sse import EventSourceResponse

from app.auth.dependencies import require_token_user_id
from app.auth.jwt_handler import decode_token
from app.db.user_profile_db import get_user_profile
from app.models.schemas import QARequest
from app.services.image_processing import (
    IMAGE_UPLOAD_MAX_BYTES,
    ImageProcessingError,
    normalize_image_bytes,
)
from app.services.qa import QATurnInput
from app.services.qa.answer_service import answer_turn_with_tools

router = APIRouter(prefix="/api/qa", tags=["题目答疑"])

# SSE 心跳间隔（秒），每 15s 发一次 heartbeat 防止前端超时断开
SSE_HEARTBEAT_INTERVAL = 15


async def _heartbeat(events: asyncio.Queue):
    """后台心跳任务，每 15s 发一次 heartbeat 事件。"""
    try:
        while True:
            await asyncio.sleep(SSE_HEARTBEAT_INTERVAL)
            events.put_nowait({"event": "heartbeat", "data": json.dumps({"text": ""})})
    except asyncio.CancelledError:
        # 任务被取消是正常结束路径，无需额外清理
        pass


async def _generate_with_heartbeat(generate):
    """在 generate() 基础上叠加心跳事件，保证长回答期间连接不超时。"""
    events: asyncio.Queue = asyncio.Queue()
    task = asyncio.create_task(_heartbeat(events))

    async def producer():
        cancelled = False
        try:
            async for event in generate:
                events.put_nowait(event)
                # Some async generators wrap synchronous SDK iterators. Give the
                # SSE consumer a scheduling opportunity after every event.
                await asyncio.sleep(0)
        except asyncio.CancelledError:
            cancelled = True
            raise
        finally:
            task.cancel()
            # 消费完所有事件后，放入 sentinel 标记结束
            if not cancelled:
                events.put_nowait(None)

    producer_task = asyncio.create_task(producer())

    try:
        while True:
            event = await events.get()
            if event is None:
                break
            yield event
    finally:
        task.cancel()
        producer_task.cancel()
        await asyncio.gather(task, producer_task, return_exceptions=True)


def get_user_id_and_profile(request: QARequest) -> tuple:
    """只信任认证 token；前端 user_id/device_id 不参与身份判定。"""
    user_id = require_token_user_id(request.token, decoder=decode_token)
    return user_id, get_user_profile(user_id)


def _event_payload(event: dict) -> dict:
    try:
        return json.loads(event.get("data") or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}


@router.post("/solve-stream")
async def solve_question_stream(
    payload: str = Form(...),
    image: UploadFile | None = File(None),
):
    """
    题目答疑接口 - 流式输出 (SSE)
    - payload: QARequest 的 JSON 字符串（multipart Form 字段）
    - image: 可选的截图文件（PNG/JPEG/WebP，≤15 MiB）
    """
    try:
        request = QARequest.model_validate_json(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_url=False)) from exc

    # 身份在建立 SSE 响应前完成认证，避免无效 token 退化为前端自报 user_id。
    user_id, _ = get_user_id_and_profile(request)

    # 图片统一先做校验 + 压缩，转成 data URL 交给 VL 模型
    image_data_url = None
    if image is not None:
        raw_image = await image.read(IMAGE_UPLOAD_MAX_BYTES + 1)
        if len(raw_image) > IMAGE_UPLOAD_MAX_BYTES:
            await image.close()
            raise HTTPException(status_code=413, detail="图片文件超过 15 MiB 上传限制")
        try:
            normalized = await run_in_threadpool(
                normalize_image_bytes, raw_image, image.content_type,
            )
        except ImageProcessingError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        finally:
            await image.close()
        image_data_url = normalized.data_url()

    async def generate():
        try:
            question = request.question or "请分析这道题"
            marker_id = request.marker_id or request.page_id or request.chat_id

            turn_input = QATurnInput(
                user_id=user_id or "anonymous",
                chat_id=request.chat_id,
                marker_id=marker_id,
                question=question,
                textbook_id=request.textbook_id,
                page_number=request.page_number,
                history=request.history,
                teaching_mode=request.teaching_mode or "socratic",
                socratic_submode=request.socratic_submode or "unclassified",
                image_data=image_data_url,
                crop_bbox=request.crop_bbox,
                screenshot_context_id=request.screenshot_context_id,
                token=request.token,
                client_turn_id=request.client_turn_id,
            )

            # 文字与截图统一进入多模态 Agent，由 LLM 自主决定是否查询 KG。
            async for event in answer_turn_with_tools(turn_input):
                yield event
        except asyncio.CancelledError:
            # 客户端断开时静默终止，不产生 error 事件
            raise
        except Exception as e:
            yield {"event": "error", "data": json.dumps({"error": str(e)})}

    return EventSourceResponse(_generate_with_heartbeat(generate()))
