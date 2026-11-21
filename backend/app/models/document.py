"""知识库文档模型"""

from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.enums import DocumentStatus


class Document(Base):
    """知识库文档表（``kb_document``）

    ``status`` 列存储的是 ``app.models.enums.DocumentStatus`` 的整数值，
    列类型保持 Integer（而不是 SQLAlchemy Enum），以保证 SQLite / MySQL
    行为一致。
    """

    __tablename__ = "kb_document"
    __table_args__ = (
        Index("idx_kb_document_category", "category"),
        Index("idx_kb_document_department", "department"),
        Index("idx_kb_document_status", "status"),
        Index("idx_kb_document_created_by", "created_by"),
        Index("idx_kb_document_vector_doc_id", "vector_doc_id"),
    )

    id: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, autoincrement=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str | None] = mapped_column(
        Text().with_variant(mysql.LONGTEXT, "mysql"), nullable=True
    )
    category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)
    file_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    vector_doc_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        doc="向量索引里的文档 ID（统一格式 doc_{id}）",
    )
    content_hash: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        doc="当前标题+分类+正文的 SHA-256 哈希",
    )
    indexed_hash: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        doc="最近一次成功同步到向量库时的内容哈希",
    )
    source_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    tags: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    chunk_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    status: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=DocumentStatus.PENDING,
        server_default=text("1"),
    )
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:  # pragma: no cover - 调试辅助
        return f"<Document id={self.id} title={self.title!r} status={self.status!r}>"


# 兼容别名
KBDocument = Document
