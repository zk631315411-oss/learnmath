from typing import Optional

from fastapi import APIRouter, Header, HTTPException, UploadFile

from app.models.schemas import FormulaConvertRequest, FormulaConvertResponse, FormulaRecognizeContentResponse
from app.routers.auth import get_user_id_from_token
from app.services.formula_conversion_service import (
    FormulaConversionError,
    formula_conversion_service,
)
from app.services.formula_vision_service import FormulaVisionError, formula_vision_service
from app.services.image_processing import IMAGE_UPLOAD_MAX_BYTES, ImageProcessingError, normalize_image_bytes

router = APIRouter(prefix="/api/formula", tags=["公式转写"])


@router.post("/convert", response_model=FormulaConvertResponse)
async def convert_formula(
    request: FormulaConvertRequest,
    authorization: Optional[str] = Header(None),
) -> FormulaConvertResponse:
    if not get_user_id_from_token(authorization):
        raise HTTPException(status_code=401, detail="未登录或 token 无效")
    try:
        latex, display_mode = await formula_conversion_service.convert(
            request.description, request.preferred_display
        )
    except FormulaConversionError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return FormulaConvertResponse(latex=latex, display_mode=display_mode)


@router.post("/recognize", response_model=FormulaConvertResponse)
async def recognize_formula(
    image: UploadFile,
    authorization: Optional[str] = Header(None),
) -> FormulaConvertResponse:
    if not get_user_id_from_token(authorization):
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "未登录或 token 无效"})
    if image.content_type and image.content_type.lower() not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(status_code=415, detail={"code": "unsupported_format", "message": "仅支持 PNG、JPEG 和 WebP 图片"})
    try:
        data = await image.read(IMAGE_UPLOAD_MAX_BYTES + 1)
        if len(data) > IMAGE_UPLOAD_MAX_BYTES:
            raise ImageProcessingError("图片文件超过 15 MiB 上传限制", 413)
        normalized = normalize_image_bytes(data, image.content_type)
    except ImageProcessingError as exc:
        code = "image_too_large" if exc.status_code == 413 else "invalid_image" if exc.status_code == 422 else "unsupported_format"
        raise HTTPException(status_code=exc.status_code, detail={"code": code, "message": str(exc)}) from exc
    try:
        latex, display_mode = await formula_vision_service.recognize(normalized)
    except FormulaVisionError as exc:
        raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": str(exc)}) from exc
    return FormulaConvertResponse(latex=latex, display_mode=display_mode)


@router.post("/recognize-content", response_model=FormulaRecognizeContentResponse, response_model_exclude_none=True)
async def recognize_formula_content(
    image: UploadFile,
    authorization: Optional[str] = Header(None),
) -> FormulaRecognizeContentResponse:
    if not get_user_id_from_token(authorization):
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "未登录或 token 无效"})
    if image.content_type and image.content_type.lower() not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(status_code=415, detail={"code": "unsupported_format", "message": "仅支持 PNG、JPEG 和 WebP 图片"})
    try:
        data = await image.read(IMAGE_UPLOAD_MAX_BYTES + 1)
        if len(data) > IMAGE_UPLOAD_MAX_BYTES:
            raise ImageProcessingError("图片文件超过 15 MiB 上传限制", 413)
        normalized = normalize_image_bytes(data, image.content_type)
    except ImageProcessingError as exc:
        code = "image_too_large" if exc.status_code == 413 else "invalid_image" if exc.status_code == 422 else "unsupported_format"
        raise HTTPException(status_code=exc.status_code, detail={"code": code, "message": str(exc)}) from exc
    try:
        blocks, warnings = await formula_vision_service.recognize_content(normalized)
    except FormulaVisionError as exc:
        raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": str(exc)}) from exc
    return FormulaRecognizeContentResponse(blocks=blocks, warnings=warnings)
