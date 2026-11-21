"""文档管理 API 路由（文档管理与索引同步彻底解耦）"""

import os

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import (
    get_current_user_id,
    require_admin,
    require_editor_or_admin,
    success_response,
)
from app.models.user import User
from app.schemas.document import (
    BatchDeleteRequest,
    ClearDocumentsRequest,
    DocumentCreate,
    DocumentListItem,
    DocumentResponse,
    DocumentUpdate,
)
from app.services.document_service import (
    DocumentService,
    SyncInProgressError,
    extract_text_from_upload,
)
from app.services.user_service import UserService

router = APIRouter(prefix="/api/document", tags=["文档管理"])

_success = success_response
_get_current_user = get_current_user_id

_MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
_UPLOAD_CHUNK_SIZE = 1024 * 1024   # 1 MB


@router.post("")
def create_document(
    data: DocumentCreate,
    user_id: int = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """创建纯文本文档（即时落库为待索引，不触发后台向量化）"""
    if not (data.title and data.title.strip()):
        raise HTTPException(status_code=400, detail="文档标题不能为空")

    safe_data = data.model_copy(
        update={
            "title": data.title.strip(),
            "file_path": None,
            "file_type": data.file_type or "txt",
        }
    )
    try:
        doc = DocumentService.create(db, safe_data, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return _success(
        data=DocumentResponse.model_validate(doc).model_dump(),
        message="文档创建成功，待同步索引",
    )


@router.post("/upload")
def upload_document(
    file: UploadFile = File(...),
    title: str | None = Form(None),
    category: str | None = Form(None),
    department: str | None = Form(None),
    user_id: int = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """上传文件并在请求内提取纯文本保存（不保留 uploads/ 临时文件，不自动触发向量化）"""
    original_filename = file.filename or "untitled"
    stem, _ = os.path.splitext(original_filename)

    chunks: list[bytes] = []
    total_read = 0
    while True:
        chunk = file.file.read(_UPLOAD_CHUNK_SIZE)
        if not chunk:
            break
        total_read += len(chunk)
        if total_read > _MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="文件大小超过 50MB 限制")
        chunks.append(chunk)

    raw_bytes = b"".join(chunks)
    try:
        file_type, extracted_text = extract_text_from_upload(original_filename, raw_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    doc_title = title.strip() if title and title.strip() else (stem or "未命名文档")
    doc_data = DocumentCreate(
        title=doc_title,
        content=extracted_text,
        file_type=file_type,
        file_path=None,
        category=category.strip() if category and category.strip() else None,
        department=department.strip() if department and department.strip() else None,
    )
    doc = DocumentService.create(db, doc_data, user_id)
    return _success(
        data=DocumentResponse.model_validate(doc).model_dump(),
        message="文档上传并解析成功，待同步索引",
    )


@router.get("/list")
def get_document_list(
    page: int = 1,
    page_size: int = 20,
    category: str | None = None,
    department: str | None = None,
    status: int | None = None,
    keyword: str | None = None,
    db: Session = Depends(get_db),
):
    """文档列表（分页、筛选，不返回大段正文 content）"""
    docs, total = DocumentService.get_list(
        db,
        page=page,
        page_size=page_size,
        category=category,
        department=department,
        status=status,
        keyword=keyword,
    )
    return _success(
        data={
            "total": total,
            "items": [DocumentListItem.model_validate(d).model_dump() for d in docs],
            "page": page,
            "page_size": page_size,
        }
    )


@router.get("/categories")
def get_categories(db: Session = Depends(get_db)):
    """获取文档分类列表"""
    categories = DocumentService.get_categories(db)
    return _success(data={"categories": categories})


@router.get("/sync-status")
def get_sync_status(db: Session = Depends(get_db)):
    """获取数据库文档与向量索引的同步状态"""
    status_data = DocumentService.get_sync_status(db)
    return _success(data=status_data)


@router.post("/batch-delete")
def batch_delete_documents(
    data: BatchDeleteRequest,
    user_id: int = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """批量删除文档（毫秒级删除 DB 记录）"""
    ids = list(dict.fromkeys(data.ids))
    if not ids:
        raise HTTPException(status_code=400, detail="请选择要删除的文档")

    current_user = UserService.get_by_id(db, user_id)
    is_admin = bool(current_user and current_user.role == "admin")

    docs = DocumentService.get_all_documents(db)
    target_docs = [d for d in docs if d.id in set(ids)]
    if not is_admin:
        unauthorized = [d.id for d in target_docs if d.created_by != user_id]
        if unauthorized:
            raise HTTPException(status_code=403, detail="无权限删除他人创建的文档")

    deleted_count = DocumentService.batch_delete(db, ids)
    return _success(
        data={"deleted_count": deleted_count},
        message=f"已删除 {deleted_count} 篇文档",
    )


@router.post("/clear")
def clear_documents(
    data: ClearDocumentsRequest = Body(default_factory=ClearDocumentsRequest),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """按筛选条件或全量清空文档（仅管理员，毫秒级直接删 DB 记录）"""
    category = data.category.strip() if data.category and data.category.strip() else None
    keyword = data.keyword.strip() if data.keyword and data.keyword.strip() else None
    deleted_count = DocumentService.clear_documents(
        db,
        category=category,
        keyword=keyword,
        status=data.status,
    )
    return _success(
        data={"deleted_count": deleted_count},
        message=f"已删除 {deleted_count} 篇文档",
    )


@router.post("/sync-index")
def sync_index(
    _user: User = Depends(require_editor_or_admin),
    db: Session = Depends(get_db),
):
    """增量同步索引到 ai_service（仅 admin / editor）"""
    try:
        result = DocumentService.sync_index(db)
    except SyncInProgressError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI 服务调用失败: {exc}")

    return _success(
        data=result,
        message=(
            f"同步完成：更新 {result['upserted_count']} 篇，"
            f"清理 {result['deleted_count']} 篇，"
            f"跳过 {result['skipped_count']} 篇"
            + (f"，失败 {result['failed_count']} 篇" if result["failed_count"] else "")
        ),
    )


@router.post("/rebuild-index")
def rebuild_index(
    _user: User = Depends(require_editor_or_admin),
    db: Session = Depends(get_db),
):
    """严格基于 kb_document 全量记录重建索引（仅 admin / editor）"""
    try:
        result = DocumentService.rebuild_index(db)
    except SyncInProgressError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI 服务调用失败: {exc}")

    return _success(
        data=result,
        message=(
            f"全量重建完成：成功 {result['upserted_count']} 篇，"
            f"总切片 {result['total_chunks']} 个"
            + (f"，失败 {result['failed_count']} 篇" if result["failed_count"] else "")
        ),
    )


@router.get("/{document_id}")
def get_document(
    document_id: int,
    db: Session = Depends(get_db),
):
    """获取文档详情（含完整 content）"""
    doc = DocumentService.get_by_id(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    return _success(data=DocumentResponse.model_validate(doc).model_dump())


@router.put("/{document_id}")
def update_document(
    document_id: int,
    data: DocumentUpdate,
    user_id: int = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """更新文档（仅创建者或管理员可更新）"""
    existing = DocumentService.get_by_id(db, document_id)
    if not existing:
        raise HTTPException(status_code=404, detail="文档不存在")
    current_user = UserService.get_by_id(db, user_id)
    if existing.created_by != user_id and (not current_user or current_user.role != "admin"):
        raise HTTPException(status_code=403, detail="无权限修改此文档")

    safe_update = data.model_copy(
        update={"file_path": None, "vector_doc_id": None, "chunk_count": None, "status": None}
    )
    try:
        doc = DocumentService.update(db, document_id, safe_update)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return _success(
        data=DocumentResponse.model_validate(doc).model_dump(),
        message="文档更新成功",
    )


@router.delete("/{document_id}")
def delete_document(
    document_id: int,
    user_id: int = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """单条删除文档（仅创建者或管理员可删除，毫秒级删除 DB 记录）"""
    current_user = UserService.get_by_id(db, user_id)
    doc = DocumentService.get_by_id(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    if doc.created_by != user_id and (not current_user or current_user.role != "admin"):
        raise HTTPException(status_code=403, detail="无权限删除此文档")

    DocumentService.delete_document(db, document_id)
    return _success(message="文档已删除")
