"""Reusable authentication dependencies for authenticated API routes."""

from __future__ import annotations

from typing import Callable, Optional

from fastapi import HTTPException

from app.auth.jwt_handler import decode_token


def user_id_from_token(
    token: Optional[str],
    *,
    decoder: Callable[[str], dict] = decode_token,
) -> Optional[str]:
    """Decode a raw JWT and return its user id, or ``None`` for invalid input."""
    if not token:
        return None
    try:
        user_id = decoder(token).get("user_id")
    except Exception:
        return None
    return str(user_id) if user_id else None


def require_token_user_id(
    token: Optional[str],
    *,
    decoder: Callable[[str], dict] = decode_token,
) -> str:
    """Return a user id from a raw JWT or raise the standard 401."""
    user_id = user_id_from_token(token, decoder=decoder)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录或token无效")
    return user_id


def require_user_id(
    authorization: Optional[str],
    *,
    decoder: Callable[[str], dict] = decode_token,
) -> str:
    """Return the user id from a Bearer header or raise the standard 401."""
    parts = (authorization or "").split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="未登录或token无效")
    try:
        user_id = decoder(parts[1]).get("user_id")
    except Exception as exc:
        raise HTTPException(status_code=401, detail="未登录或token无效") from exc
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录或token无效")
    return str(user_id)
