"""统一鉴权依赖与响应工具（避免各路由重复复制并实时校验数据库用户状态与角色）。"""

import time

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.services.user_service import UserService


def success_response(data=None, message: str = "success") -> dict:
    return {
        "code": 200,
        "message": message,
        "data": data,
        "timestamp": int(time.time()),
    }


def _extract_bearer_payload(authorization: str | None) -> dict:
    if not authorization:
        raise HTTPException(status_code=401, detail="未提供认证令牌")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="认证令牌格式错误")
    payload = UserService.decode_access_token(token)
    if payload is None or payload.get("user_id") is None:
        raise HTTPException(status_code=401, detail="认证令牌无效或已过期")
    return payload


def get_current_user(
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
) -> User:
    """解析 JWT 并查库验证用户存在且未被禁用。"""
    payload = _extract_bearer_payload(authorization)
    user = UserService.get_by_id(db, int(payload["user_id"]))
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在或已失效")
    if user.status == 0:
        raise HTTPException(status_code=403, detail="账号已被禁用")
    return user


def get_current_user_id(user: User = Depends(get_current_user)) -> int:
    return user.id


def require_admin(user: User = Depends(get_current_user)) -> User:
    """基于数据库最新角色校验管理员权限，防止已降权账号继续使用旧 JWT。"""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="无权限访问，需要管理员角色")
    return user
