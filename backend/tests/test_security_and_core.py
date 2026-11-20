"""CampusQA 后端核心安全与业务逻辑回归测试（纯内存 SQLite，零外部 MySQL/Redis 依赖）。"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@compiles(BigInteger, "sqlite")
def _compile_bigint_sqlite(type_, compiler, **kw):
    return "INTEGER"

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.user_service import UserService  # noqa: E402


@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as tc:
        yield tc, TestingSessionLocal
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


def _auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _register_and_login(tc: TestClient, username: str, password: str = "secret123", role: str = "student"):
    r = tc.post(
        "/api/user/register",
        json={"username": username, "password": password, "role": role},
    )
    assert r.status_code == 200, r.text
    login = tc.post("/api/user/login", json={"username": username, "password": password})
    assert login.status_code == 200, login.text
    body = login.json()["data"]
    return r.json()["data"], body["access_token"]


def test_public_register_cannot_escalate_to_admin(client):
    """P0 安全：公开注册即使传入 role=admin，也必须强制落库为 student。"""
    tc, _ = client
    user_data, token = _register_and_login(tc, "attacker", role="admin")
    assert user_data["role"] == "student"

    # 尝试调用管理员接口必须返回 403
    resp = tc.get("/api/user/list", headers=_auth_header(token))
    assert resp.status_code == 403


def test_disabled_user_jwt_is_rejected_immediately(client):
    """P0 安全：账号被禁用后，尚在有效期内的旧 JWT 必须立即失效。"""
    tc, SessionLocal = client
    user_data, token = _register_and_login(tc, "bob")

    # 在数据库中禁用该用户
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.id == user_data["id"]).first()
        u.status = 0
        db.commit()
    finally:
        db.close()

    resp = tc.get("/api/user/profile", headers=_auth_header(token))
    assert resp.status_code == 403


def test_qa_session_idor_isolation_and_history_schema(client):
    """P0 安全与功能：用户 A 的会话不能被用户 B 读取或评价，且历史列表字段与前端完全对齐。"""
    tc, _ = client
    _, token_a = _register_and_login(tc, "alice")
    _, token_b = _register_and_login(tc, "charlie")

    # 用户 A 提问并保存回答
    ask = tc.post(
        "/api/qa/ask",
        params={"question": "报销审批流程是什么？", "session_id": "sess-alice-1"},
        headers=_auth_header(token_a),
    )
    assert ask.status_code == 200
    rec_id = ask.json()["data"]["id"]

    ans = tc.post(
        "/api/qa/answer",
        json={"record_id": rec_id, "answer": "需在 15 个工作日内提交审批。", "sources": []},
        headers=_auth_header(token_a),
    )
    assert ans.status_code == 200

    # 用户 B 尝试越权偷看用户 A 的会话 → 必须返回 0 条
    steal = tc.get("/api/qa/session/sess-alice-1", headers=_auth_header(token_b))
    assert steal.status_code == 200
    assert steal.json()["data"]["total"] == 0

    # 用户 B 尝试越权修改用户 A 的反馈 → 必须返回 403
    fb = tc.post(
        "/api/qa/feedback",
        params={"record_id": rec_id, "feedback": 2},
        headers=_auth_header(token_b),
    )
    assert fb.status_code == 403

    # 验证用户 A 历史会话字段与前端 Chat.tsx 契约完全匹配
    hist = tc.get("/api/qa/history", headers=_auth_header(token_a))
    assert hist.status_code == 200
    items = hist.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["session_id"] == "sess-alice-1"
    assert items[0]["question_count"] == 1
    assert items[0]["last_question"] == "报销审批流程是什么？"
    assert items[0]["updated_at"]


def test_document_update_blocks_idor_and_strips_client_file_path(client, monkeypatch):
    """P0 安全：非创建者不能修改他人文档，且创建接口忽略客户端传入的服务器 file_path。"""
    tc, _ = client
    from app.services.document_service import IngestionService

    monkeypatch.setattr(IngestionService, "enqueue", lambda self, doc_id, db: None)

    _, token_a = _register_and_login(tc, "author_a")
    _, token_b = _register_and_login(tc, "other_b")

    create = tc.post(
        "/api/document",
        json={"title": "接口鉴权规范", "content": "内容", "file_path": "/etc/passwd"},
        headers=_auth_header(token_a),
    )
    assert create.status_code == 202
    doc = create.json()["data"]
    assert doc["file_path"] is None

    # 非创建者尝试 PUT 修改文档 → 403
    upd = tc.put(
        f"/api/document/{doc['id']}",
        json={"title": "被篡改标题"},
        headers=_auth_header(token_b),
    )
    assert upd.status_code == 403


def test_admin_user_management_and_self_protection(client):
    """管理员创建用户、筛选全部状态以及禁止自删/自降权校验。"""
    tc, SessionLocal = client
    admin_data, admin_token = _register_and_login(tc, "root_admin")

    # 将测试账号提权为 admin
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.id == admin_data["id"]).first()
        u.role = "admin"
        db.commit()
    finally:
        db.close()

    # 管理员创建 teacher 账号
    created = tc.post(
        "/api/user/admin/create",
        json={"username": "prof_li", "password": "password123", "role": "teacher"},
        headers=_auth_header(admin_token),
    )
    assert created.status_code == 200
    assert created.json()["data"]["role"] == "teacher"

    # 禁止管理员将自己降权
    demote = tc.put(
        f"/api/user/{admin_data['id']}/role",
        params={"role": "student"},
        headers=_auth_header(admin_token),
    )
    assert demote.status_code == 400

    # 禁止管理员禁用自己
    disable = tc.put(
        f"/api/user/{admin_data['id']}/status",
        params={"status": 0},
        headers=_auth_header(admin_token),
    )
    assert disable.status_code == 400
