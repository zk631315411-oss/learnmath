from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from app.auth.dependencies import user_id_from_token
from app.auth.jwt_handler import (
    create_access_token,
    decode_token,
    generate_user_id,
    get_password_hash,
    verify_password,
)
from app.db.auth_db import (
    get_user_by_device_id,
    get_user_by_id,
    get_user_by_username,
    save_user,
)
from app.db.user_profile_db import get_user_profile, save_user_profile
from app.models.schemas import TokenResponse, UserLogin, UserProfileResponse, UserRegister

router = APIRouter(prefix="/api/auth", tags=["用户认证"])


def is_anonymous_user(user: dict) -> bool:
    """读取显式标记，并兼容改造前创建的匿名账号。"""
    if bool(user.get("is_anonymous", 0)):
        return True
    if not user.get("username", "").startswith("user_"):
        return False
    try:
        return verify_password("anonymous_user_placeholder", user.get("password_hash", ""))
    except Exception:
        return False


def get_user_id_from_token(authorization: Optional[str]) -> Optional[str]:
    """从Authorization header解析user_id"""
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return user_id_from_token(parts[1], decoder=decode_token)


def _token_response(user: dict) -> TokenResponse:
    """Build the canonical token response for an existing account."""
    anonymous = is_anonymous_user(user)
    token = create_access_token({
        "user_id": user["id"],
        "username": user["username"],
        "is_anonymous": anonymous,
    })
    return TokenResponse(
        access_token=token,
        user_id=user["id"],
        username=user["username"],
        is_anonymous=anonymous,
    )


@router.post("/register", response_model=TokenResponse)
def register(req: UserRegister):
    """用户注册"""
    # 检查用户名是否已存在
    existing = get_user_by_username(req.username)
    if existing:
        raise HTTPException(status_code=400, detail="用户名已存在")

    # 创建用户
    user_id = generate_user_id()
    password_hash = get_password_hash(req.password)
    success = save_user(user_id, req.username, password_hash, req.device_id, is_anonymous=False)
    if not success:
        raise HTTPException(status_code=500, detail="创建用户失败")

    # 创建空画像
    save_user_profile(user_id)

    # 生成token
    token = create_access_token({"user_id": user_id, "username": req.username, "is_anonymous": False})
    return TokenResponse(
        access_token=token,
        user_id=user_id,
        username=req.username,
        is_anonymous=False
    )


@router.post("/login", response_model=TokenResponse)
def login(req: UserLogin):
    """用户登录"""
    user = get_user_by_username(req.username)
    if not user:
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    return _token_response(user)


@router.post("/anonymous", response_model=TokenResponse)
def anonymous_access(device_id: str):
    """匿名访问（设备首次访问自动创建账户）"""
    # 检查设备是否已有账户
    existing = get_user_by_device_id(device_id)
    if existing:
        return _token_response(existing)

    # 自动创建匿名账户
    user_id = generate_user_id()
    username = f"user_{device_id[:8]}"  # 用设备ID前8位作为默认用户名
    password_hash = get_password_hash("")
    success = save_user(user_id, username, password_hash, device_id, is_anonymous=True)
    if not success:
        # 并发下首次查询后可能已被其他请求创建，取回该账户而非报 500
        existing = get_user_by_device_id(device_id)
        if existing:
            return _token_response(existing)
        raise HTTPException(status_code=500, detail="创建匿名账户失败")

    # 创建空画像
    save_user_profile(user_id)

    token = create_access_token({"user_id": user_id, "username": username, "is_anonymous": True})
    return TokenResponse(
        access_token=token,
        user_id=user_id,
        username=username,
        is_anonymous=True
    )


@router.get("/me", response_model=UserProfileResponse)
def get_current_user(authorization: Optional[str] = Header(None)):
    """获取当前登录用户信息"""
    user_id = get_user_id_from_token(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录或token无效")

    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    profile = get_user_profile(user_id)
    return UserProfileResponse(
        id=user_id,
        username=user["username"],
        is_anonymous=is_anonymous_user(user),
        grade=profile.get("grade") if profile else "",
        weak_points=profile.get("weak_points", []) if profile else [],
        strong_points=profile.get("strong_points", []) if profile else [],
        created_at=user["created_at"]
    )
