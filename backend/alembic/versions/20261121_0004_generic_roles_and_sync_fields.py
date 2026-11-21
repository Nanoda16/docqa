"""Generic user roles and document sync hash fields

1. Add ``content_hash`` and ``indexed_hash`` to ``kb_document``;
2. Change ``sys_user.role`` server default from ``student`` to ``user``;
3. Migrate legacy roles: ``student`` -> ``user``, ``teacher`` -> ``editor``;
4. Backfill missing ``content_hash`` and ``vector_doc_id`` on ``kb_document``.

Create Date: 2026-11-21 00:15:00
"""

from typing import Sequence, Union
import hashlib

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20261121_0004"
down_revision: Union[str, None] = "20261017_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _compute_doc_hash(
    title: str | None, content: str | None, category: str | None
) -> str:
    raw = f"{title or ''}\n{category or ''}\n{content or ''}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    doc_cols = {col["name"] for col in inspector.get_columns("kb_document")}

    if "content_hash" not in doc_cols:
        op.add_column(
            "kb_document",
            sa.Column(
                "content_hash",
                sa.String(64),
                nullable=True,
                comment="当前标题+分类+正文的 SHA-256 哈希",
            ),
        )
    if "indexed_hash" not in doc_cols:
        op.add_column(
            "kb_document",
            sa.Column(
                "indexed_hash",
                sa.String(64),
                nullable=True,
                comment="最近一次成功同步到向量库时的内容哈希",
            ),
        )

    # 修改 sys_user.role 默认值为 'user'
    with op.batch_alter_table("sys_user") as batch_op:
        batch_op.alter_column(
            "role",
            existing_type=sa.String(20),
            nullable=False,
            server_default="user",
        )

    # 迁移历史校园角色
    bind.execute(sa.text("UPDATE sys_user SET role = 'user' WHERE role = 'student'"))
    bind.execute(sa.text("UPDATE sys_user SET role = 'editor' WHERE role = 'teacher'"))

    # 回填历史文档的 content_hash 与缺失的 vector_doc_id
    rows = bind.execute(
        sa.text(
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
        bind.execute(
            sa.text(
                "UPDATE kb_document "
                "SET content_hash = :content_hash, vector_doc_id = :vector_doc_id "
                "WHERE id = :id"
            ),
            {"content_hash": new_hash, "vector_doc_id": new_vid, "id": doc_id},
        )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE sys_user SET role = 'student' WHERE role = 'user'"))
    bind.execute(sa.text("UPDATE sys_user SET role = 'teacher' WHERE role = 'editor'"))

    with op.batch_alter_table("sys_user") as batch_op:
        batch_op.alter_column(
            "role",
            existing_type=sa.String(20),
            nullable=False,
            server_default="student",
        )

    inspector = sa.inspect(bind)
    doc_cols = {col["name"] for col in inspector.get_columns("kb_document")}
    if "indexed_hash" in doc_cols:
        op.drop_column("kb_document", "indexed_hash")
    if "content_hash" in doc_cols:
        op.drop_column("kb_document", "content_hash")
