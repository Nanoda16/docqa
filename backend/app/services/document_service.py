"""文档业务服务（文档管理与向量索引解耦 + 增量同步）"""

from __future__ import annotations

import hashlib
import io
import os
import threading
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from app.cache.qa_cache import QACache
from app.models.document import Document
from app.models.enums import DocumentStatus
from app.schemas.document import DocumentCreate, DocumentUpdate
from app.services.rag_service import RAGService

# 保留常量导出供兼容引用（上传不再永久落盘到此目录）
UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"

# 进程内同步/重建互斥锁，避免并发重复执行索引写入
_sync_lock = threading.Lock()


class SyncInProgressError(RuntimeError):
    """已有索引同步或全量重建任务正在进行"""


def compute_content_hash(
    title: str | None,
    content: str | None,
    category: str | None = None,
) -> str:
    """统一计算文档内容哈希（SHA-256 hex）"""
    raw = f"{title or ''}\n{category or ''}\n{content or ''}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _decode_text_bytes(raw_bytes: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gbk", "gb18030"):
        try:
            return raw_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw_bytes.decode("utf-8", errors="replace")


def _extract_docx_text(raw_bytes: bytes) -> str:
    from docx import Document as DocxDocument

    doc = DocxDocument(io.BytesIO(raw_bytes))
    parts: list[str] = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            parts.append(text)
    for table in doc.tables:
        for row in table.rows:
            cells = [cell.text.strip().replace("\n", " ") for cell in row.cells]
            row_text = " | ".join(c for c in cells if c)
            if row_text:
                parts.append(row_text)
    return "\n\n".join(parts)


def _extract_pdf_text(raw_bytes: bytes) -> str:
    pages_text: list[str] = []
    try:
        import pdfplumber

        with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
            for page in pdf.pages:
                text = (page.extract_text() or "").strip()
                if text:
                    pages_text.append(text)
    except Exception:
        pages_text = []

    if not pages_text:
        try:
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(raw_bytes))
            for page in reader.pages:
                text = (page.extract_text() or "").strip()
                if text:
                    pages_text.append(text)
        except Exception as exc:
            raise ValueError(f"PDF 解析失败: {exc}") from exc

    return "\n\n".join(pages_text)


def extract_text_from_upload(filename: str, raw_bytes: bytes) -> tuple[str, str]:
    """从上传文件字节流中直接提取纯文本。

    Returns
    -------
    tuple[str, str]
        ``(file_type, extracted_text)``
    """
    _, ext = os.path.splitext(filename or "")
    ext_lower = ext.lower()

    if ext_lower == ".doc":
        raise ValueError("暂不支持旧版 .doc 二进制格式，请先转换为 .docx、.pdf 或 .txt/.md 后再上传")

    if ext_lower not in {".txt", ".md", ".pdf", ".docx"}:
        raise ValueError(f"不支持的文件类型: {ext or '未知'}，仅支持 .pdf / .docx / .txt / .md")

    if ext_lower in {".txt", ".md"}:
        extracted = _decode_text_bytes(raw_bytes)
    elif ext_lower == ".docx":
        try:
            extracted = _extract_docx_text(raw_bytes)
        except Exception as exc:
            raise ValueError(f"DOCX 文件解析失败: {exc}") from exc
    else:
        extracted = _extract_pdf_text(raw_bytes)

    cleaned = extracted.strip()
    if not cleaned:
        raise ValueError("未能从文件中提取到有效文本内容（可能是空白文件或纯图片扫描件）")

    return ext_lower.lstrip("."), cleaned


class DocumentService:
    """文档服务"""

    @staticmethod
    def create(db: Session, data: DocumentCreate, user_id: int) -> Document:
        """创建文档（即时落库为 PENDING，不触发后台向量化）"""
        title = (data.title or "").strip()
        if not title:
            raise ValueError("文档标题不能为空")

        content_hash = compute_content_hash(title, data.content, data.category)
        document = Document(
            title=title,
            content=data.content,
            category=data.category,
            department=data.department,
            file_type=data.file_type,
            file_path=None,
            content_hash=content_hash,
            indexed_hash=None,
            source_url=data.source_url,
            tags=data.tags,
            chunk_count=0,
            status=DocumentStatus.PENDING,
            error_message=None,
            created_by=user_id,
        )
        db.add(document)
        db.flush()
        document.vector_doc_id = f"doc_{document.id}"
        db.commit()
        db.refresh(document)
        return document

    @staticmethod
    def get_by_id(db: Session, document_id: int) -> Document | None:
        """根据ID获取文档"""
        return db.query(Document).filter(Document.id == document_id).first()

    @staticmethod
    def update(db: Session, document_id: int, data: DocumentUpdate) -> Document | None:
        """更新文档并按内容哈希自动推导同步状态"""
        document = DocumentService.get_by_id(db, document_id)
        if not document:
            return None

        update_data = data.model_dump(exclude_unset=True)
        # 禁止外部直接篡改索引元数据与路径
        for protected in ("file_path", "vector_doc_id", "chunk_count", "status"):
            update_data.pop(protected, None)

        if "title" in update_data:
            if update_data["title"] is None or not str(update_data["title"]).strip():
                raise ValueError("文档标题不能为空")
            update_data["title"] = str(update_data["title"]).strip()

        for key, value in update_data.items():
            setattr(document, key, value)

        if not document.vector_doc_id:
            document.vector_doc_id = f"doc_{document.id}"

        new_hash = compute_content_hash(document.title, document.content, document.category)
        document.content_hash = new_hash

        if document.indexed_hash:
            if new_hash != document.indexed_hash:
                document.status = DocumentStatus.OUTDATED
            else:
                document.status = DocumentStatus.SYNCED
                document.error_message = None
        else:
            document.status = DocumentStatus.PENDING
            document.error_message = None

        db.commit()
        db.refresh(document)
        return document

    @staticmethod
    def delete_document(db: Session, document_id: int) -> bool:
        """毫秒级删除单篇数据库文档（不阻塞调用 ai_service）"""
        document = DocumentService.get_by_id(db, document_id)
        if not document:
            return False
        db.delete(document)
        db.commit()
        return True

    @staticmethod
    def soft_delete(db: Session, document_id: int) -> bool:
        """兼容旧调用别名"""
        return DocumentService.delete_document(db, document_id)

    @staticmethod
    def batch_delete(db: Session, document_ids: list[int]) -> int:
        """批量删除数据库文档"""
        if not document_ids:
            return 0
        deleted = (
            db.query(Document)
            .filter(Document.id.in_(document_ids))
            .delete(synchronize_session=False)
        )
        db.commit()
        return int(deleted or 0)

    @staticmethod
    def _apply_filters(
        query,
        category: str | None = None,
        department: str | None = None,
        status: int | None = None,
        keyword: str | None = None,
    ):
        """统一构建文档筛选条件"""
        if category:
            query = query.filter(Document.category == category)
        if department:
            query = query.filter(Document.department == department)
        if status is not None:
            query = query.filter(Document.status == status)
        if keyword:
            like_pattern = f"%{keyword}%"
            query = query.filter(
                Document.title.ilike(like_pattern)
                | Document.content.ilike(like_pattern)
            )
        return query

    @staticmethod
    def clear_documents(
        db: Session,
        category: str | None = None,
        keyword: str | None = None,
        status: int | None = None,
    ) -> int:
        """按条件批量删除或全量清空数据库文档（毫秒级删除，不调用 ai_service）"""
        query = DocumentService._apply_filters(
            db.query(Document),
            category=category,
            status=status,
            keyword=keyword,
        )
        deleted = query.delete(synchronize_session=False)
        db.commit()
        return int(deleted or 0)

    @staticmethod
    def get_list(
        db: Session,
        page: int = 1,
        page_size: int = 20,
        category: str | None = None,
        department: str | None = None,
        status: int | None = None,
        keyword: str | None = None,
    ) -> tuple[list[Document], int]:
        """获取文档列表（分页 + 筛选）"""
        query = DocumentService._apply_filters(
            db.query(Document),
            category=category,
            department=department,
            status=status,
            keyword=keyword,
        )

        total = query.count()
        documents = (
            query.order_by(Document.updated_at.desc(), Document.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return documents, total

    @staticmethod
    def get_all_documents(db: Session) -> list[Document]:
        """获取所有文档"""
        return db.query(Document).order_by(Document.id).all()

    @staticmethod
    def get_categories(db: Session) -> list[str]:
        """获取所有文档分类"""
        results = (
            db.query(Document.category)
            .filter(Document.category.isnot(None))
            .distinct()
            .all()
        )
        return sorted([r[0] for r in results if r[0]])

    @staticmethod
    def _ensure_doc_sync_fields(doc: Document) -> tuple[str, str]:
        vid = doc.vector_doc_id or f"doc_{doc.id}"
        c_hash = doc.content_hash or compute_content_hash(doc.title, doc.content, doc.category)
        return vid, c_hash

    @staticmethod
    def get_sync_status(db: Session) -> dict:
        """计算数据库与 ai_service 向量库的同步状态"""
        docs = DocumentService.get_all_documents(db)
        total_docs = len(docs)
        synced_docs = sum(1 for d in docs if d.status == DocumentStatus.SYNCED)
        failed_docs = sum(1 for d in docs if d.status == DocumentStatus.FAILED)

        ai_service_online = False
        indexed_ids: set[str] = set()
        indexed_chunks = 0
        try:
            state = RAGService.get_index_state(timeout=5.0)
            ai_service_online = True
            indexed_ids = set(state.get("doc_ids") or [])
            indexed_chunks = int(state.get("chunk_count") or 0)
        except Exception:
            ai_service_online = False

        db_vector_ids: set[str] = set()
        pending_upsert = 0
        for d in docs:
            vid, c_hash = DocumentService._ensure_doc_sync_fields(d)
            db_vector_ids.add(vid)
            needs_sync = (d.indexed_hash != c_hash) or (d.status != DocumentStatus.SYNCED)
            if ai_service_online and vid not in indexed_ids:
                needs_sync = True
            if needs_sync:
                pending_upsert += 1

        pending_delete = len(indexed_ids - db_vector_ids) if ai_service_online else 0
        in_sync = bool(ai_service_online and pending_upsert == 0 and pending_delete == 0)

        return {
            "total_docs": total_docs,
            "synced_docs": synced_docs,
            "pending_upsert": pending_upsert,
            "pending_delete": pending_delete,
            "failed_docs": failed_docs,
            "indexed_chunks": indexed_chunks,
            "ai_service_online": ai_service_online,
            "in_sync": in_sync,
        }

    @staticmethod
    def _apply_sync_results(
        db: Session,
        docs: list[Document],
        result: dict,
    ) -> tuple[int, int]:
        """根据 ai_service /index/sync 或 /index/rebuild 响应回写文档状态"""
        doc_by_vid: dict[str, Document] = {}
        for d in docs:
            vid, c_hash = DocumentService._ensure_doc_sync_fields(d)
            d.vector_doc_id = vid
            d.content_hash = c_hash
            doc_by_vid[vid] = d

        now = datetime.now()
        upserted = result.get("upserted") or []
        failed = result.get("failed") or []

        for item in upserted:
            vid = item.get("doc_id")
            doc = doc_by_vid.get(vid)
            if doc is not None:
                doc.status = DocumentStatus.SYNCED
                doc.indexed_hash = doc.content_hash
                doc.chunk_count = int(item.get("chunk_count") or 0)
                doc.error_message = None
                doc.processed_at = now

        for item in failed:
            vid = item.get("doc_id")
            doc = doc_by_vid.get(vid)
            if doc is not None:
                doc.status = DocumentStatus.FAILED
                doc.error_message = str(item.get("error") or "索引同步失败")[:500]
                doc.processed_at = now

        db.commit()
        QACache.clear_qa_cache()
        return len(upserted), len(failed)

    @staticmethod
    def sync_index(db: Session) -> dict:
        """增量同步文档索引到 ai_service"""
        if not _sync_lock.acquire(blocking=False):
            raise SyncInProgressError("正在执行索引同步或重建，请稍后再试")

        try:
            state = RAGService.get_index_state(timeout=5.0)
            indexed_ids = set(state.get("doc_ids") or [])
            current_chunks = int(state.get("chunk_count") or 0)

            docs = DocumentService.get_all_documents(db)
            db_vector_ids: set[str] = set()
            to_upsert: list[dict] = []
            skipped_count = 0

            for d in docs:
                vid, c_hash = DocumentService._ensure_doc_sync_fields(d)
                d.vector_doc_id = vid
                d.content_hash = c_hash
                db_vector_ids.add(vid)

                if (
                    vid not in indexed_ids
                    or d.indexed_hash != c_hash
                    or d.status != DocumentStatus.SYNCED
                ):
                    to_upsert.append(
                        {
                            "doc_id": vid,
                            "title": d.title,
                            "content": d.content or "",
                            "category": d.category or "",
                        }
                    )
                else:
                    skipped_count += 1

            to_delete = sorted(indexed_ids - db_vector_ids)

            if not to_upsert and not to_delete:
                db.commit()
                return {
                    "upserted_count": 0,
                    "deleted_count": 0,
                    "skipped_count": skipped_count,
                    "failed_count": 0,
                    "total_docs": len(docs),
                    "total_chunks": current_chunks,
                }

            result = RAGService.sync_index(
                upsert=to_upsert,
                delete_doc_ids=to_delete,
                timeout=600.0,
            )
            upserted_count, failed_count = DocumentService._apply_sync_results(
                db, docs, result
            )
            return {
                "upserted_count": upserted_count,
                "deleted_count": int(result.get("deleted_count", len(to_delete))),
                "skipped_count": skipped_count,
                "failed_count": failed_count,
                "total_docs": int(result.get("total_docs", len(docs))),
                "total_chunks": int(result.get("total_chunks", 0)),
            }
        finally:
            _sync_lock.release()

    @staticmethod
    def rebuild_index(db: Session) -> dict:
        """严格基于 kb_document 全量记录重建 ai_service 索引"""
        if not _sync_lock.acquire(blocking=False):
            raise SyncInProgressError("正在执行索引同步或重建，请稍后再试")

        try:
            docs = DocumentService.get_all_documents(db)
            documents_payload: list[dict] = []
            for d in docs:
                vid, c_hash = DocumentService._ensure_doc_sync_fields(d)
                d.vector_doc_id = vid
                d.content_hash = c_hash
                documents_payload.append(
                    {
                        "doc_id": vid,
                        "title": d.title,
                        "content": d.content or "",
                        "category": d.category or "",
                    }
                )

            result = RAGService.rebuild_index(documents_payload, timeout=600.0)
            upserted_count, failed_count = DocumentService._apply_sync_results(
                db, docs, result
            )
            return {
                "upserted_count": upserted_count,
                "deleted_count": int(result.get("deleted_count", 0)),
                "skipped_count": 0,
                "failed_count": failed_count,
                "total_docs": int(result.get("total_docs", len(docs))),
                "total_chunks": int(result.get("total_chunks", 0)),
            }
        finally:
            _sync_lock.release()
