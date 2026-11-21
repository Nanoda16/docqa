"""文档相关 Pydantic 模型"""

from datetime import datetime
from pydantic import BaseModel, Field


class DocumentCreate(BaseModel):
    """文档创建请求"""
    title: str = Field(..., min_length=1, max_length=255, description="文档标题")
    content: str | None = Field(None, description="文档内容")
    category: str | None = Field(None, max_length=50, description="分类")
    department: str | None = Field(None, max_length=100, description="所属部门")
    file_type: str | None = Field(None, max_length=20, description="文件类型")
    file_path: str | None = Field(None, max_length=500, description="文件路径（服务端忽略）")
    source_url: str | None = Field(None, max_length=500, description="来源URL")
    tags: list[str] | None = Field(None, description="标签数组")
    status: int = Field(1, description="索引状态: 1=待索引,2=待更新,3=已同步,4=失败")


class DocumentUpdate(BaseModel):
    """文档更新请求"""
    title: str | None = Field(None, max_length=255)
    content: str | None = None
    category: str | None = Field(None, max_length=50)
    department: str | None = Field(None, max_length=100)
    file_type: str | None = Field(None, max_length=20)
    file_path: str | None = None
    vector_doc_id: str | None = None
    source_url: str | None = Field(None, max_length=500)
    tags: list[str] | None = None
    chunk_count: int | None = None
    status: int | None = None


class BatchDeleteRequest(BaseModel):
    """批量删除文档请求"""
    ids: list[int] = Field(..., min_length=1, description="待删除文档 ID 列表")


class ClearDocumentsRequest(BaseModel):
    """按条件或全量清空文档请求"""
    category: str | None = Field(None, max_length=50, description="按分类筛选")
    keyword: str | None = Field(None, max_length=255, description="按关键词筛选")
    status: int | None = Field(None, description="按状态筛选")


class DocumentListItem(BaseModel):
    """文档列表项响应（不包含大段 content，减轻列表查询负载）"""
    id: int
    title: str
    category: str | None
    department: str | None
    file_type: str | None
    vector_doc_id: str | None = None
    status: int
    chunk_count: int
    error_message: str | None = None
    processed_at: datetime | None = None
    created_by: int | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DocumentResponse(BaseModel):
    """文档详情响应"""
    id: int
    title: str
    content: str | None
    category: str | None
    department: str | None
    file_type: str | None
    file_path: str | None
    vector_doc_id: str | None = None
    content_hash: str | None = None
    indexed_hash: str | None = None
    source_url: str | None
    tags: list | None
    chunk_count: int
    status: int
    error_message: str | None = None
    processed_at: datetime | None = None
    created_by: int | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DocumentList(BaseModel):
    """文档列表响应"""
    total: int
    items: list[DocumentListItem]
    page: int
    page_size: int
