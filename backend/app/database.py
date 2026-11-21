"""SQLAlchemy 数据库引擎和会话管理"""

import hashlib

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings


# 创建数据库引擎（同步，使用 pymysql）
engine = create_engine(
    settings.DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    echo=False,
)

# 会话工厂
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """SQLAlchemy 声明式基类"""
    pass


def get_db():
    """FastAPI 依赖注入：获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _compute_doc_hash(
    title: str | None, content: str | None, category: str | None
) -> str:
    raw = f"{title or ''}\n{category or ''}\n{content or ''}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _ensure_schema_compatibility(target_engine: Engine) -> None:
    """幂等升级历史库表结构与旧角色/哈希数据（兼容 SQLite 与 MySQL 8）。"""
    inspector = inspect(target_engine)
    table_names = set(inspector.get_table_names())

    with target_engine.begin() as conn:
        # 1. kb_document 缺失字段幂等补齐
        if "kb_document" in table_names:
            doc_cols = {col["name"] for col in inspector.get_columns("kb_document")}
            if "vector_doc_id" not in doc_cols:
                conn.execute(
                    text("ALTER TABLE kb_document ADD COLUMN vector_doc_id VARCHAR(64)")
                )
            if "error_message" not in doc_cols:
                conn.execute(
                    text("ALTER TABLE kb_document ADD COLUMN error_message VARCHAR(500)")
                )
            if "processed_at" not in doc_cols:
                conn.execute(
                    text("ALTER TABLE kb_document ADD COLUMN processed_at DATETIME")
                )
            if "content_hash" not in doc_cols:
                conn.execute(
                    text("ALTER TABLE kb_document ADD COLUMN content_hash VARCHAR(64)")
                )
            if "indexed_hash" not in doc_cols:
                conn.execute(
                    text("ALTER TABLE kb_document ADD COLUMN indexed_hash VARCHAR(64)")
                )

            # 回填历史文档的 content_hash 与缺失的 vector_doc_id
            rows = conn.execute(
                text(
                    "SELECT id, title, category, content, content_hash, vector_doc_id "
                    "FROM kb_document "
                    "WHERE content_hash IS NULL OR vector_doc_id IS NULL OR vector_doc_id = ''"
                )
            ).mappings().all()
            for row in rows:
                doc_id = row["id"]
                new_hash = row["content_hash"] or _compute_doc_hash(
                    row["title"], row["content"], row["category"]
                )
                new_vid = row["vector_doc_id"] or f"doc_{doc_id}"
                conn.execute(
                    text(
                        "UPDATE kb_document "
                        "SET content_hash = :content_hash, vector_doc_id = :vector_doc_id "
                        "WHERE id = :id"
                    ),
                    {
                        "content_hash": new_hash,
                        "vector_doc_id": new_vid,
                        "id": doc_id,
                    },
                )

        # 2. sys_user 旧校园角色平滑迁移为通用角色
        if "sys_user" in table_names:
            conn.execute(
                text("UPDATE sys_user SET role = 'user' WHERE role = 'student'")
            )
            conn.execute(
                text("UPDATE sys_user SET role = 'editor' WHERE role = 'teacher'")
            )


def init_db(target_engine: Engine | None = None) -> None:
    """创建所有数据库表并执行幂等兼容升级。"""
    eng = target_engine or engine
    # 确保所有 ORM 模型都已注册到 Base.metadata
    import app.models  # noqa: F401

    Base.metadata.create_all(bind=eng)
    _ensure_schema_compatibility(eng)
