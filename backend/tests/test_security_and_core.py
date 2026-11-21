"""DocQA 后端核心安全与业务逻辑回归测试（纯内存 SQLite，零外部 MySQL/Redis 依赖）。"""

from __future__ import annotations

import io
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger, create_engine, inspect, text
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@compiles(BigInteger, "sqlite")
def _compile_bigint_sqlite(type_, compiler, **kw):
    return "INTEGER"


BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.cache.qa_cache import QACache  # noqa: E402
from app.config import settings  # noqa: E402
from app.database import Base, get_db, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.document import Document  # noqa: E402
from app.models.enums import DocumentStatus  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.document_service import compute_content_hash  # noqa: E402
from app.services.rag_service import RAGService, _internal_headers  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app.disk_cache import DiskCache
    from app.redis_client import redis_client

    test_cache = DiskCache(db_path=str(tmp_path / "test_cache.db"))
    monkeypatch.setattr(redis_client, "_client", test_cache)

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


def _register_and_login(
    tc: TestClient,
    username: str,
    password: str = "secret123",
    role: str = "user",
):
    r = tc.post(
        "/api/user/register",
        json={"username": username, "password": password, "role": role},
    )
    assert r.status_code == 200, r.text
    login = tc.post(
        "/api/user/login", json={"username": username, "password": password}
    )
    assert login.status_code == 200, login.text
    body = login.json()["data"]
    return r.json()["data"], body["access_token"]


def test_first_user_auto_admin_and_second_user_forced_user(client):
    """首用户自动获得 admin，系统初始化状态切换，第二用户即使传 role=admin 也强制为 user。"""
    tc, _ = client

    # 注册前未初始化
    s0 = tc.get("/api/user/setup-status")
    assert s0.status_code == 200
    assert s0.json()["data"]["initialized"] is False

    # 第一个用户自动成为 admin
    first_data, first_token = _register_and_login(tc, "first_admin", role="user")
    assert first_data["role"] == "admin"

    # 注册后已初始化
    s1 = tc.get("/api/user/setup-status")
    assert s1.status_code == 200
    assert s1.json()["data"]["initialized"] is True

    # 第二个用户尝试越权注册 admin → 必须强制落库为 user
    second_data, second_token = _register_and_login(tc, "attacker", role="admin")
    assert second_data["role"] == "user"

    # 第二用户访问管理员接口必须返回 403
    resp = tc.get("/api/user/list", headers=_auth_header(second_token))
    assert resp.status_code == 403

    # 首用户（admin）访问管理员接口正常
    ok = tc.get("/api/user/list", headers=_auth_header(first_token))
    assert ok.status_code == 200
    assert ok.json()["data"]["total"] == 2


def test_disabled_user_jwt_is_rejected_immediately(client):
    """P0 安全：账号被禁用后，尚在有效期内的旧 JWT 必须立即失效。"""
    tc, SessionLocal = client
    _register_and_login(tc, "boot_admin")
    user_data, token = _register_and_login(tc, "bob")

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

    steal = tc.get("/api/qa/session/sess-alice-1", headers=_auth_header(token_b))
    assert steal.status_code == 200
    assert steal.json()["data"]["total"] == 0

    fb = tc.post(
        "/api/qa/feedback",
        params={"record_id": rec_id, "feedback": 2},
        headers=_auth_header(token_b),
    )
    assert fb.status_code == 403

    hist = tc.get("/api/qa/history", headers=_auth_header(token_a))
    assert hist.status_code == 200
    items = hist.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["session_id"] == "sess-alice-1"
    assert items[0]["question_count"] == 1
    assert items[0]["last_question"] == "报销审批流程是什么？"
    assert items[0]["updated_at"]


def test_admin_user_management_reset_password_and_self_protection(client):
    """管理员创建 editor、重置密码并验证新密码登录、以及禁止自降权/自禁用。"""
    tc, _ = client
    admin_data, admin_token = _register_and_login(tc, "root_admin")
    assert admin_data["role"] == "admin"

    # 管理员创建 editor 账号
    created = tc.post(
        "/api/user/admin/create",
        json={"username": "editor_li", "password": "password123", "role": "editor"},
        headers=_auth_header(admin_token),
    )
    assert created.status_code == 200
    editor_id = created.json()["data"]["id"]
    assert created.json()["data"]["role"] == "editor"

    # 管理员重置 editor 密码
    reset_resp = tc.put(
        f"/api/user/{editor_id}/reset-password",
        json={"new_password": "newpass456"},
        headers=_auth_header(admin_token),
    )
    assert reset_resp.status_code == 200

    # 使用新密码登录成功，旧密码失败
    old_login = tc.post(
        "/api/user/login", json={"username": "editor_li", "password": "password123"}
    )
    assert old_login.status_code == 400
    new_login = tc.post(
        "/api/user/login", json={"username": "editor_li", "password": "newpass456"}
    )
    assert new_login.status_code == 200

    # 禁止非 admin 调重置密码
    editor_token = new_login.json()["data"]["access_token"]
    forbid = tc.put(
        f"/api/user/{admin_data['id']}/reset-password",
        json={"new_password": "hacked123"},
        headers=_auth_header(editor_token),
    )
    assert forbid.status_code == 403

    # 禁止管理员将自己降权、禁用或传入非法角色
    demote = tc.put(
        f"/api/user/{admin_data['id']}/role",
        params={"role": "user"},
        headers=_auth_header(admin_token),
    )
    assert demote.status_code == 400

    bad_role = tc.put(
        f"/api/user/{editor_id}/role",
        params={"role": "student"},
        headers=_auth_header(admin_token),
    )
    assert bad_role.status_code == 400

    disable = tc.put(
        f"/api/user/{admin_data['id']}/status",
        params={"status": 0},
        headers=_auth_header(admin_token),
    )
    assert disable.status_code == 400


def test_document_create_upload_edit_and_batch_delete(client):
    """纯文本新建、文件解析上传（无 uploads 残留）、IDOR 隔离、列表/详情区分及批量删除。"""
    tc, _ = client
    _, admin_token = _register_and_login(tc, "doc_admin")
    _, token_a = _register_and_login(tc, "author_a")
    _, token_b = _register_and_login(tc, "other_b")

    # 1. 新建纯文本文档（即时返回 200，忽略 file_path）
    create = tc.post(
        "/api/document",
        json={
            "title": "接口鉴权规范",
            "content": "所有内部接口必须校验 X-Internal-Token。",
            "category": "tech",
            "file_path": "/etc/passwd",
        },
        headers=_auth_header(token_a),
    )
    assert create.status_code == 200, create.text
    doc = create.json()["data"]
    assert doc["file_path"] is None
    assert doc["status"] == DocumentStatus.PENDING
    assert doc["vector_doc_id"] == f"doc_{doc['id']}"
    assert doc["content_hash"] == compute_content_hash(
        "接口鉴权规范", "所有内部接口必须校验 X-Internal-Token。", "tech"
    )

    # 2. 非创建者尝试 PUT 修改文档 → 403
    upd_forbid = tc.put(
        f"/api/document/{doc['id']}",
        json={"title": "被篡改标题"},
        headers=_auth_header(token_b),
    )
    assert upd_forbid.status_code == 403

    # 3. 上传 .md / .docx 文件，以及不支持的 .doc / 空文本提示
    upload_md = tc.post(
        "/api/document/upload",
        files={"file": ("guide.md", "# 报销指南\n请附发票。".encode("utf-8"), "text/markdown")},
        data={"category": "policy"},
        headers=_auth_header(token_a),
    )
    assert upload_md.status_code == 200, upload_md.text
    doc_md = upload_md.json()["data"]
    assert doc_md["file_type"] == "md"
    assert doc_md["status"] == DocumentStatus.PENDING
    assert "请附发票" in doc_md["content"]

    # 构造内存 .docx
    from docx import Document as DocxDocument

    buf = io.BytesIO()
    d = DocxDocument()
    d.add_paragraph("员工差旅住宿标准为每晚不超过 500 元。")
    d.save(buf)
    buf.seek(0)
    upload_docx = tc.post(
        "/api/document/upload",
        files={
            "file": (
                "travel.docx",
                buf.read(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
        headers=_auth_header(token_a),
    )
    assert upload_docx.status_code == 200, upload_docx.text
    assert "500 元" in upload_docx.json()["data"]["content"]

    # .doc 给出清晰错误提示
    bad_doc = tc.post(
        "/api/document/upload",
        files={"file": ("legacy.doc", b"dummy", "application/msword")},
        headers=_auth_header(token_a),
    )
    assert bad_doc.status_code == 400
    assert ".docx" in bad_doc.json()["detail"]

    # 空文件拒绝
    empty_txt = tc.post(
        "/api/document/upload",
        files={"file": ("empty.txt", b"   \n  ", "text/plain")},
        headers=_auth_header(token_a),
    )
    assert empty_txt.status_code == 400

    # 4. 列表不返回大段 content，详情返回完整 content，且支持 status 筛选
    lst = tc.get("/api/document/list", params={"status": DocumentStatus.PENDING})
    assert lst.status_code == 200
    items = lst.json()["data"]["items"]
    assert lst.json()["data"]["total"] == 3
    assert "content" not in items[0]

    detail = tc.get(f"/api/document/{doc['id']}")
    assert detail.status_code == 200
    assert detail.json()["data"]["content"] == "所有内部接口必须校验 X-Internal-Token。"

    # 5. 非创建者批量删除他人文档 → 403
    batch_forbid = tc.post(
        "/api/document/batch-delete",
        json={"ids": [doc["id"], doc_md["id"]]},
        headers=_auth_header(token_b),
    )
    assert batch_forbid.status_code == 403

    # 6. 管理员批量删除 2 篇文档成功
    batch_ok = tc.post(
        "/api/document/batch-delete",
        json={"ids": [doc["id"], doc_md["id"]]},
        headers=_auth_header(admin_token),
    )
    assert batch_ok.status_code == 200
    assert batch_ok.json()["data"]["deleted_count"] == 2

    lst_after = tc.get("/api/document/list")
    assert lst_after.json()["data"]["total"] == 1


def test_sync_status_and_incremental_sync_flow(client, monkeypatch):
    """增量同步状态计算、权限校验、X-Internal-Token 透传、mock ai_service 回写与缓存失效。"""
    tc, _ = client
    _, admin_token = _register_and_login(tc, "sync_admin")
    _, normal_token = _register_and_login(tc, "normal_user")
    editor = tc.post(
        "/api/user/admin/create",
        json={"username": "sync_editor", "password": "password123", "role": "editor"},
        headers=_auth_header(admin_token),
    )
    assert editor.status_code == 200
    editor_login = tc.post(
        "/api/user/login", json={"username": "sync_editor", "password": "password123"}
    )
    editor_token = editor_login.json()["data"]["access_token"]

    # 校验 X-Internal-Token 透传
    monkeypatch.setattr(settings, "INTERNAL_API_TOKEN", "secret-internal-token")
    assert _internal_headers() == {"X-Internal-Token": "secret-internal-token"}

    # 新建 2 篇文档
    d1 = tc.post(
        "/api/document",
        json={"title": "文档一", "content": "第一篇内容", "category": "faq"},
        headers=_auth_header(editor_token),
    ).json()["data"]
    d2 = tc.post(
        "/api/document",
        json={"title": "文档二", "content": "第二篇内容", "category": "faq"},
        headers=_auth_header(editor_token),
    ).json()["data"]

    # 模拟 ai_service 内存状态（含 1 个残留 doc_999 待清理）
    fake_index: dict[str, int] = {"doc_999": 3}

    def fake_get_index_state(timeout: float = 5.0):
        return {
            "doc_ids": sorted(fake_index.keys()),
            "doc_count": len(fake_index),
            "chunk_count": sum(fake_index.values()),
            "ready": True,
        }

    def fake_sync_index(upsert: list[dict], delete_doc_ids: list[str], timeout: float = 600.0):
        for vid in delete_doc_ids:
            fake_index.pop(vid, None)
        upserted = []
        failed = []
        for item in upsert:
            if "触发失败" in item["content"]:
                failed.append({"doc_id": item["doc_id"], "error": "模拟向量化失败"})
            else:
                fake_index[item["doc_id"]] = 2
                upserted.append({"doc_id": item["doc_id"], "chunk_count": 2})
        return {
            "upserted": upserted,
            "failed": failed,
            "deleted_count": len(delete_doc_ids),
            "total_docs": len(fake_index),
            "total_chunks": sum(fake_index.values()),
        }

    monkeypatch.setattr(RAGService, "get_index_state", staticmethod(fake_get_index_state))
    monkeypatch.setattr(RAGService, "sync_index", staticmethod(fake_sync_index))

    # 普通 user 调 sync-index / rebuild-index 返回 403
    assert tc.post("/api/document/sync-index", headers=_auth_header(normal_token)).status_code == 403
    assert tc.post("/api/document/rebuild-index", headers=_auth_header(normal_token)).status_code == 403

    # 查询同步状态：pending_upsert=2, pending_delete=1, in_sync=False
    st0 = tc.get("/api/document/sync-status").json()["data"]
    assert st0["ai_service_online"] is True
    assert st0["total_docs"] == 2
    assert st0["pending_upsert"] == 2
    assert st0["pending_delete"] == 1
    assert st0["in_sync"] is False

    # 写入一条问答缓存，验证同步后被清理
    QACache.set_cached_answer(1, "测试缓存问题", "旧回答", sources=[{"title": "旧文档"}])
    cached_obj = QACache.get_cached_answer(1, "测试缓存问题")
    assert cached_obj is not None and cached_obj["answer"] == "旧回答"

    # editor 执行增量同步
    sync_resp = tc.post("/api/document/sync-index", headers=_auth_header(editor_token))
    assert sync_resp.status_code == 200, sync_resp.text
    sdata = sync_resp.json()["data"]
    assert sdata["upserted_count"] == 2
    assert sdata["deleted_count"] == 1
    assert sdata["skipped_count"] == 0
    assert sdata["failed_count"] == 0
    assert sdata["total_chunks"] == 4

    # 缓存已失效
    assert QACache.get_cached_answer(1, "测试缓存问题") is None

    # 验证文档状态回写为 SYNCED(3)
    d1_after = tc.get(f"/api/document/{d1['id']}").json()["data"]
    assert d1_after["status"] == DocumentStatus.SYNCED
    assert d1_after["chunk_count"] == 2
    assert d1_after["indexed_hash"] == d1_after["content_hash"]

    # 同步状态现在完全一致
    st1 = tc.get("/api/document/sync-status").json()["data"]
    assert st1["in_sync"] is True
    assert st1["pending_upsert"] == 0
    assert st1["pending_delete"] == 0

    # 再次同步无变更，跳过 2 篇
    sync_noop = tc.post("/api/document/sync-index", headers=_auth_header(editor_token)).json()["data"]
    assert sync_noop["upserted_count"] == 0
    assert sync_noop["skipped_count"] == 2

    # 编辑 d1 正文后自动转为 OUTDATED(2)
    upd1 = tc.put(
        f"/api/document/{d1['id']}",
        json={"content": "第一篇内容（已更新）"},
        headers=_auth_header(editor_token),
    ).json()["data"]
    assert upd1["status"] == DocumentStatus.OUTDATED

    # 改回原正文自动恢复 SYNCED(3)
    upd2 = tc.put(
        f"/api/document/{d1['id']}",
        json={"content": "第一篇内容"},
        headers=_auth_header(editor_token),
    ).json()["data"]
    assert upd2["status"] == DocumentStatus.SYNCED

    # 模拟单篇同步失败：将 d2 改为包含“触发失败”，同步后状态应为 FAILED(4)
    tc.put(
        f"/api/document/{d2['id']}",
        json={"content": "触发失败的内容"},
        headers=_auth_header(editor_token),
    )
    sync_fail = tc.post("/api/document/sync-index", headers=_auth_header(editor_token)).json()["data"]
    assert sync_fail["failed_count"] == 1
    d2_failed = tc.get(f"/api/document/{d2['id']}").json()["data"]
    assert d2_failed["status"] == DocumentStatus.FAILED
    assert "模拟向量化失败" in d2_failed["error_message"]


def test_init_db_idempotent_legacy_migration():
    """老库升级兼容性：自动补齐 kb_document 新列、回填哈希/vector_doc_id，并迁移 student/teacher 角色。"""
    legacy_engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with legacy_engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE sys_user (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username VARCHAR(50) NOT NULL UNIQUE,
                    password_hash VARCHAR(255) NOT NULL,
                    nickname VARCHAR(50),
                    email VARCHAR(100),
                    role VARCHAR(20) NOT NULL DEFAULT 'student',
                    avatar VARCHAR(255),
                    status INTEGER NOT NULL DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE kb_document (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title VARCHAR(255) NOT NULL,
                    content TEXT,
                    category VARCHAR(50),
                    department VARCHAR(100),
                    file_type VARCHAR(20),
                    file_path VARCHAR(500),
                    source_url VARCHAR(500),
                    tags JSON,
                    chunk_count INTEGER NOT NULL DEFAULT 0,
                    status INTEGER NOT NULL DEFAULT 1,
                    created_by INTEGER,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        )
        conn.execute(
            text(
                "INSERT INTO sys_user (username, password_hash, role) VALUES "
                "('stu1', 'h', 'student'), ('tea1', 'h', 'teacher'), ('adm1', 'h', 'admin')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO kb_document (title, content, category) VALUES "
                "('历史制度', '历史正文', 'policy')"
            )
        )

    # 连续两次调用 init_db 验证幂等性
    init_db(legacy_engine)
    init_db(legacy_engine)

    cols = {c["name"] for c in inspect(legacy_engine).get_columns("kb_document")}
    assert {"content_hash", "indexed_hash", "vector_doc_id", "error_message", "processed_at"} <= cols

    with legacy_engine.connect() as conn:
        roles = dict(conn.execute(text("SELECT username, role FROM sys_user")).all())
        assert roles == {"stu1": "user", "tea1": "editor", "adm1": "admin"}

        row = conn.execute(
            text("SELECT id, vector_doc_id, content_hash FROM kb_document")
        ).mappings().first()
        assert row["vector_doc_id"] == f"doc_{row['id']}"
        assert row["content_hash"] == compute_content_hash("历史制度", "历史正文", "policy")


def test_rebuild_index_and_sync_lock_conflict(client, monkeypatch):
    """全量重建仅基于 kb_document 且并发同步返回 409。"""
    tc, _ = client
    _, admin_token = _register_and_login(tc, "rb_admin")
    doc = tc.post(
        "/api/document",
        json={"title": "重建文档", "content": "重建正文", "category": "guide"},
        headers=_auth_header(admin_token),
    ).json()["data"]

    captured: list[dict] = []

    def fake_rebuild(documents: list[dict], timeout: float = 600.0):
        captured.extend(documents)
        return {
            "upserted": [{"doc_id": d["doc_id"], "chunk_count": 4} for d in documents],
            "failed": [],
            "deleted_count": 0,
            "total_docs": len(documents),
            "total_chunks": 4 * len(documents),
        }

    monkeypatch.setattr(RAGService, "rebuild_index", staticmethod(fake_rebuild))

    resp = tc.post("/api/document/rebuild-index", headers=_auth_header(admin_token))
    assert resp.status_code == 200, resp.text
    assert len(captured) == 1
    assert captured[0]["doc_id"] == doc["vector_doc_id"]
    assert resp.json()["data"]["total_chunks"] == 4

    doc_after = tc.get(f"/api/document/{doc['id']}").json()["data"]
    assert doc_after["status"] == DocumentStatus.SYNCED
    assert doc_after["chunk_count"] == 4

    # 模拟锁已被占用时请求同步/重建，返回 409
    from app.services import document_service as ds_mod

    ds_mod._sync_lock.acquire()
    try:
        conflict = tc.post("/api/document/sync-index", headers=_auth_header(admin_token))
        assert conflict.status_code == 409
    finally:
        ds_mod._sync_lock.release()


def test_clear_documents_by_filter_and_full(client):
    """POST /api/document/clear：非 admin 返回 403，admin 可按条件或全量清空。"""
    tc, _ = client
    _, admin_token = _register_and_login(tc, "clear_admin")
    _, user_token = _register_and_login(tc, "clear_user")

    tc.post(
        "/api/user/admin/create",
        json={"username": "clear_editor", "password": "password123", "role": "editor"},
        headers=_auth_header(admin_token),
    )
    editor_token = tc.post(
        "/api/user/login", json={"username": "clear_editor", "password": "password123"}
    ).json()["data"]["access_token"]

    for idx, (cat, title) in enumerate(
        [("news", "旧新闻1"), ("news", "旧新闻2"), ("policy", "公司制度"), ("tech", "研发规范")],
        start=1,
    ):
        r = tc.post(
            "/api/document",
            json={"title": title, "content": f"正文 {idx}", "category": cat},
            headers=_auth_header(admin_token),
        )
        assert r.status_code == 200

    # 普通 user 与 editor 均无权调用 clear
    assert tc.post("/api/document/clear", json={}, headers=_auth_header(user_token)).status_code == 403
    assert tc.post("/api/document/clear", json={}, headers=_auth_header(editor_token)).status_code == 403

    # admin 按分类 news 清空
    res_cat = tc.post(
        "/api/document/clear",
        json={"category": "news"},
        headers=_auth_header(admin_token),
    )
    assert res_cat.status_code == 200, res_cat.text
    assert res_cat.json()["data"]["deleted_count"] == 2
    assert res_cat.json()["message"] == "已删除 2 篇文档"
    assert tc.get("/api/document/list").json()["data"]["total"] == 2

    # admin 不带筛选条件（传空对象/不传 body）全量清空剩余文档
    res_all = tc.post("/api/document/clear", headers=_auth_header(admin_token))
    assert res_all.status_code == 200, res_all.text
    assert res_all.json()["data"]["deleted_count"] == 2
    assert res_all.json()["message"] == "已删除 2 篇文档"
    assert tc.get("/api/document/list").json()["data"]["total"] == 0


def test_feedback_driven_cache_and_admin_cache_management(client):
    """用户驱动缓存（点赞写入、点踩删除、bypass_cache）与管理员缓存键精准增删查。"""
    tc, _ = client
    _, admin_token = _register_and_login(tc, "cache_admin")
    _, user_token = _register_and_login(tc, "cache_user")

    question = "差旅住宿报销上限是多少？"
    sources = [{"doc_id": "doc_1", "title": "差旅制度", "score": 0.92, "content": "每晚不超过 500 元"}]

    # 1. 首次提问 → 未命中缓存
    ask1 = tc.post(
        "/api/qa/ask",
        params={"question": question, "session_id": "sess-cache-1"},
        headers=_auth_header(user_token),
    )
    assert ask1.status_code == 200
    rec1_id = ask1.json()["data"]["id"]
    assert ask1.json()["data"].get("from_cache") is not True

    # 2. 保存回答后，不自动写入缓存
    ans1 = tc.post(
        "/api/qa/answer",
        json={"record_id": rec1_id, "answer": "每晚不超过 500 元。", "sources": sources},
        headers=_auth_header(user_token),
    )
    assert ans1.status_code == 200

    ask2 = tc.post(
        "/api/qa/ask",
        params={"question": question, "session_id": "sess-cache-1"},
        headers=_auth_header(user_token),
    )
    assert ask2.status_code == 200
    assert ask2.json()["data"].get("from_cache") is not True
    rec2_id = ask2.json()["data"]["id"]

    # 3. 对无缓存记录点踩 → 不报错且 cache_action="none"
    dislike_miss = tc.post(
        "/api/qa/feedback",
        params={"record_id": rec2_id, "feedback": 2},
        headers=_auth_header(user_token),
    )
    assert dislike_miss.status_code == 200
    assert dislike_miss.json()["data"]["cache_action"] == "none"

    # 4. 对第一条记录点赞 → 写入问答缓存（含 sources）
    like_ok = tc.post(
        "/api/qa/feedback",
        params={"record_id": rec1_id, "feedback": 1},
        headers=_auth_header(user_token),
    )
    assert like_ok.status_code == 200
    assert like_ok.json()["data"]["cache_action"] == "cached"

    # 5. 再次提问 → 命中缓存，且带回 sources 与真实落库 id
    ask3 = tc.post(
        "/api/qa/ask",
        params={"question": question, "session_id": "sess-cache-2"},
        headers=_auth_header(user_token),
    )
    assert ask3.status_code == 200
    d3 = ask3.json()["data"]
    assert d3["from_cache"] is True
    assert isinstance(d3["id"], int) and d3["id"] > rec2_id
    assert d3["answer"] == "每晚不超过 500 元。"
    assert d3["sources"] == sources

    # 6. bypass_cache=true 时跳过缓存重新生成
    ask_bypass = tc.post(
        "/api/qa/ask",
        params={"question": question, "session_id": "sess-cache-2", "bypass_cache": True},
        headers=_auth_header(user_token),
    )
    assert ask_bypass.status_code == 200
    assert ask_bypass.json()["data"].get("from_cache") is not True

    # 7. 对缓存命中产生的记录点踩 → 从缓存移除
    dislike_hit = tc.post(
        "/api/qa/feedback",
        params={"record_id": d3["id"], "feedback": 2},
        headers=_auth_header(user_token),
    )
    assert dislike_hit.status_code == 200
    assert dislike_hit.json()["data"]["cache_action"] == "invalidated"

    # 移除后再次提问 → 不再命中缓存
    ask4 = tc.post(
        "/api/qa/ask",
        params={"question": question, "session_id": "sess-cache-2"},
        headers=_auth_header(user_token),
    )
    assert ask4.status_code == 200
    assert ask4.json()["data"].get("from_cache") is not True

    # 8. 重新点赞以生成一条 qa 缓存键，测试管理员缓存键接口
    tc.post(
        "/api/qa/feedback",
        params={"record_id": rec1_id, "feedback": 1},
        headers=_auth_header(user_token),
    )

    # 非管理员访问全部返回 403
    assert tc.get("/api/admin/cache/key", params={"key": "doc:qa:any"}, headers=_auth_header(user_token)).status_code == 403
    assert tc.delete("/api/admin/cache/key", params={"key": "doc:qa:any"}, headers=_auth_header(user_token)).status_code == 403
    assert tc.post("/api/admin/cache/keys/delete", json={"keys": ["doc:qa:any"]}, headers=_auth_header(user_token)).status_code == 403

    # 列表含 category
    keys_resp = tc.get("/api/admin/cache/keys", headers=_auth_header(admin_token))
    assert keys_resp.status_code == 200
    all_keys = keys_resp.json()["data"]["keys"]
    qa_keys = [item["key"] for item in all_keys if item["category"] == "qa"]
    session_keys = [item["key"] for item in all_keys if item["category"] == "session"]
    assert len(qa_keys) >= 1
    assert len(session_keys) >= 1

    # 非 doc:qa: 前缀键拒绝（400）
    assert tc.get("/api/admin/cache/key", params={"key": "other:key"}, headers=_auth_header(admin_token)).status_code == 400
    assert tc.delete("/api/admin/cache/key", params={"key": "other:key"}, headers=_auth_header(admin_token)).status_code == 400
    assert tc.post("/api/admin/cache/keys/delete", json={"keys": ["other:key"]}, headers=_auth_header(admin_token)).status_code == 400

    # 查看单条缓存键详情
    detail = tc.get("/api/admin/cache/key", params={"key": qa_keys[0]}, headers=_auth_header(admin_token))
    assert detail.status_code == 200
    assert detail.json()["data"]["category"] == "qa"
    assert "每晚不超过 500 元" in detail.json()["data"]["value"]

    # 单条删除
    del_one = tc.delete("/api/admin/cache/key", params={"key": qa_keys[0]}, headers=_auth_header(admin_token))
    assert del_one.status_code == 200
    assert del_one.json()["data"]["deleted"] == 1

    # 批量删除剩余 session/hot 键
    del_batch = tc.post(
        "/api/admin/cache/keys/delete",
        json={"keys": session_keys},
        headers=_auth_header(admin_token),
    )
    assert del_batch.status_code == 200
    assert del_batch.json()["data"]["deleted"] == len(session_keys)
