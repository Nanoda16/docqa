"""用户相关 API 路由"""

import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, get_current_user_id, require_admin, success_response
from app.models.user import User
from app.schemas.user import (
    Token,
    UserCreate,
    UserLogin,
    UserResponse,
    UserUpdate,
)
from app.services.user_service import UserService

router = APIRouter(prefix="/api/user", tags=["用户管理"])

_success = success_response
_get_current_user = get_current_user_id


@router.post("/register")
def register(data: UserCreate, db: Session = Depends(get_db)):
    """公开用户注册（服务端强制 student 角色，忽略客户端传入的特权角色）"""
    try:
        user = UserService.register(db, data, allow_privileged_role=False)
        return _success(
            data=UserResponse.model_validate(user).model_dump(),
            message="注册成功",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/admin/create")
def admin_create_user(
    data: UserCreate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理员创建用户（允许指定 student/teacher/admin 角色）"""
    try:
        user = UserService.register(db, data, allow_privileged_role=True)
        return _success(
            data=UserResponse.model_validate(user).model_dump(),
            message="创建成功",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/login")
def login(data: UserLogin, db: Session = Depends(get_db)):
    """用户登录"""
    try:
        user = UserService.login(db, data.username, data.password)
        token = UserService.create_access_token(
            {"user_id": user.id, "username": user.username, "role": user.role}
        )
        return _success(
            data=Token(
                access_token=token,
                user=UserResponse.model_validate(user),
            ).model_dump(),
            message="登录成功",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/profile")
def get_profile(
    user_id: int = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """获取个人信息"""
    user = UserService.get_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return _success(data=UserResponse.model_validate(user).model_dump())


class ChangePassword(BaseModel):
    old_password: str = Field(..., min_length=1, max_length=72)
    new_password: str = Field(..., min_length=6, max_length=72)


@router.put("/change-password")
def change_password(
    data: ChangePassword,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """修改密码"""
    if not UserService.verify_password(data.old_password, user.password_hash):
        raise HTTPException(status_code=400, detail="原密码错误")
    user.password_hash = UserService.hash_password(data.new_password)
    db.commit()
    return _success(message="密码修改成功")


@router.put("/profile")
def update_profile(
    data: UserUpdate,
    user_id: int = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """更新个人信息"""
    user = UserService.update_profile(db, user_id, data)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return _success(
        data=UserResponse.model_validate(user).model_dump(),
        message="更新成功",
    )


@router.get("/list")
def get_user_list(
    page: int = 1,
    page_size: int = 20,
    role: str | None = None,
    status: int | None = None,
    keyword: str | None = None,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理员获取用户列表（status=None 返回全部状态用户）"""
    users, total = UserService.get_user_list(
        db, page=page, page_size=page_size, role=role, status=status, keyword=keyword
    )
    return _success(
        data={
            "total": total,
            "items": [UserResponse.model_validate(u).model_dump() for u in users],
            "page": page,
            "page_size": page_size,
        }
    )


@router.put("/{target_user_id}/role")
def admin_update_role(
    target_user_id: int,
    role: str,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理员修改用户角色"""
    if role not in ("student", "teacher", "admin"):
        raise HTTPException(status_code=400, detail="无效的角色: 必须是 student/teacher/admin")
    if target_user_id == current_user.id and role != "admin":
        raise HTTPException(status_code=400, detail="不能降低自己的管理员权限")
    target = UserService.get_by_id(db, target_user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    target.role = role
    db.commit()
    db.refresh(target)
    return _success(
        data=UserResponse.model_validate(target).model_dump(),
        message="角色已更新",
    )


@router.put("/{target_user_id}/status")
def admin_update_status(
    target_user_id: int,
    status: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理员启用/禁用用户"""
    if status not in (0, 1):
        raise HTTPException(status_code=400, detail="无效的状态: 0=禁用, 1=启用")
    if target_user_id == current_user.id and status == 0:
        raise HTTPException(status_code=400, detail="不能禁用自己")
    target = UserService.get_by_id(db, target_user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    target.status = status
    db.commit()
    db.refresh(target)
    return _success(
        data=UserResponse.model_validate(target).model_dump(),
        message="启用" if status == 1 else "已禁用",
    )


@router.put("/{target_user_id}")
def admin_update_user(
    target_user_id: int,
    data: UserUpdate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理员修改用户全部信息"""
    target = UserService.update_profile(db, target_user_id, data)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    return _success(
        data=UserResponse.model_validate(target).model_dump(),
        message="用户信息已更新",
    )


@router.delete("/{target_user_id}")
def admin_delete_user(
    target_user_id: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理员删除用户（硬删除：彻底从数据库移除）"""
    if target_user_id == current_user.id:
        raise HTTPException(status_code=400, detail="不能删除自己")
    target = UserService.get_by_id(db, target_user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    UserService.delete_user(db, target_user_id)
    return _success(message="用户已永久删除")
