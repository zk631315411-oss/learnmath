from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from app.models.schemas import FormulaConvertRequest, FormulaConvertResponse
from app.routers.auth import get_user_id_from_token
from app.services.formula_conversion_service import (
    FormulaConversionError,
    formula_conversion_service,
)

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
