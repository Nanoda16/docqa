"""
AI Service — FastAPI server for RAG query, streaming, and indexing.

Endpoints
---------
GET  /health        → Health check
POST /query         → Synchronous RAG query
GET  /query/stream  → SSE streaming query
GET  /reindex       → Full re-index all documents
POST /process       → Index a single file
GET  /stats         → Knowledge base statistics
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse
from starlette.concurrency import run_in_threadpool

from engine.pipeline import RAGPipeline

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger("ai_service")

# ---------------------------------------------------------------------------
# Security & Allowed Paths
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).resolve().parent.parent
_INTERNAL_TOKEN = os.environ.get("INTERNAL_API_TOKEN", "").strip()
_CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "AI_CORS_ORIGINS",
        "http://localhost:8002,http://127.0.0.1:8002,http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if o.strip()
]


def verify_internal_token(x_internal_token: str | None = Header(None)) -> None:
    """若设置了 INTERNAL_API_TOKEN，则强制校验内部调用方凭证。"""
    expected = os.environ.get("INTERNAL_API_TOKEN", _INTERNAL_TOKEN).strip()
    if expected and x_internal_token != expected:
        raise HTTPException(status_code=403, detail="Forbidden: invalid internal token")


_verify_internal_token = verify_internal_token


def _allowed_process_roots() -> list[Path]:
    roots = [
        (_REPO_ROOT / "knowledge_docs").resolve(),
        (_REPO_ROOT / "backend" / "uploads").resolve(),
    ]
    kdir = os.environ.get("KNOWLEDGE_DIR", "").strip()
    if kdir:
        roots.append(Path(kdir).resolve())
    extra = os.environ.get("AI_ALLOWED_DIRS", "").strip()
    if extra:
        for item in extra.split(os.pathsep):
            if item.strip():
                roots.append(Path(item.strip()).resolve())
    return roots


def _validate_file_path(file_path: str) -> Path:
    target = Path(file_path).resolve()
    if not any(target.is_relative_to(root) for root in _allowed_process_roots()):
        raise HTTPException(
            status_code=403,
            detail="Forbidden: file_path is outside allowed knowledge/uploads directories",
        )
    return target


# ---------------------------------------------------------------------------
# App & CORS
# ---------------------------------------------------------------------------

app = FastAPI(title="AI Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Global pipeline instance
# ---------------------------------------------------------------------------

pipeline: RAGPipeline = RAGPipeline()

# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class HistoryTurn(BaseModel):
    role: str = Field(..., description='"user" or "ai"')
    content: str = Field(default="", description="Turn text")


class QueryRequest(BaseModel):
    question: str = Field(..., description="The user's question")
    top_k: int = Field(
        default=5,
        ge=1,
        le=50,
        description=(
            "Candidate depth per retriever before RRF fusion. The fused "
            "ranking is truncated to the pipeline's final window (3 chunks)."
        ),
    )
    history: list[HistoryTurn] = Field(
        default_factory=list, description="Prior conversation turns for multi-turn context"
    )


class QueryResponse(BaseModel):
    answer: str
    sources: list[dict[str, Any]]


class ProcessRequest(BaseModel):
    file_path: str = Field(..., description="Path to the document file")
    doc_id: str | None = Field(
        None,
        description=(
            "Override doc_id. Normally the id is md5(abs path), so the same "
            "file always maps to the same id."
        ),
    )
    persist: bool = Field(
        True,
        description=(
            "Copy the parsed text into the knowledge directory before indexing. "
            "Required for uploads: a full rebuild scans that directory, so a "
            "document that never landed there would vanish on the next rebuild. "
            "Pass false when re-indexing a file that already lives in the "
            "directory."
        ),
    )
    category: str | None = Field(
        None,
        description="Sub-folder / category used when persisting the document",
    )


class ProcessResponse(BaseModel):
    chunks_count: int
    indexed: int
    doc_id: str
    bm25_chunks: int = 0
    title: str = ""
    category: str = ""
    source_url: str = ""
    file_path: str = ""
    persisted_path: str | None = None


class IndexDocumentItem(BaseModel):
    doc_id: str
    title: str = ""
    content: str = ""
    category: str = ""
    source_url: str = ""


class IndexSyncRequest(BaseModel):
    upsert: list[IndexDocumentItem] = Field(default_factory=list)
    delete_doc_ids: list[str] = Field(default_factory=list)


class IndexRebuildRequest(BaseModel):
    documents: list[IndexDocumentItem] = Field(default_factory=list)


class IndexStateResponse(BaseModel):
    doc_ids: list[str]
    doc_count: int
    chunk_count: int
    ready: bool


class IndexSyncItemSuccess(BaseModel):
    doc_id: str
    chunk_count: int


class IndexSyncItemFailed(BaseModel):
    doc_id: str
    error: str


class IndexSyncResponse(BaseModel):
    upserted: list[IndexSyncItemSuccess]
    failed: list[IndexSyncItemFailed]
    deleted_count: int
    total_docs: int
    total_chunks: int


# ---------------------------------------------------------------------------
# Startup event
# ---------------------------------------------------------------------------


@app.on_event("startup")
async def startup_event() -> None:
    logger.info("AI Service running on port 8003")


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Sync query
# ---------------------------------------------------------------------------


@app.post("/query", response_model=QueryResponse, dependencies=[Depends(_verify_internal_token)])
def query(body: QueryRequest) -> dict[str, Any]:
    try:
        history = [t.model_dump() for t in body.history]
        result = pipeline.run(query=body.question, top_k=body.top_k, history=history)
        return result
    except Exception:
        logger.exception("Sync query failed")
        raise HTTPException(status_code=500, detail="AI 查询处理失败，请检查服务端日志")


# ---------------------------------------------------------------------------
# SSE streaming query
# ---------------------------------------------------------------------------


@app.get("/query/stream", dependencies=[Depends(_verify_internal_token)])
async def query_stream(
    question: str = Query(..., description="The user's question"),
    top_k: int = Query(
        default=5,
        ge=1,
        le=50,
        description="Candidate depth per retriever before RRF fusion",
    ),
    history: str = Query(default="", description="JSON-encoded prior turns"),
) -> EventSourceResponse:
    # history arrives as a JSON string (GET query param); parse defensively
    parsed_history: list[dict] = []
    if history:
        try:
            import json as _json

            raw = _json.loads(history)
            if isinstance(raw, list):
                parsed_history = [
                    {"role": t.get("role", ""), "content": t.get("content", "")}
                    for t in raw
                    if isinstance(t, dict)
                ]
        except (ValueError, TypeError):
            logger.warning("Failed to parse history query param; ignoring")

    def event_generator():
        import json as _json

        try:
            for event in pipeline.run_stream(
                query=question, top_k=top_k, history=parsed_history
            ):
                event_type = event.pop("type", None) or "unknown"
                yield {
                    "event": event_type,
                    "data": _json.dumps(event, ensure_ascii=False),
                }
        except Exception:
            logger.exception("Streaming query failed")
            yield {"event": "error", "data": _json.dumps({"message": "AI 流式问答失败，请稍后重试"}, ensure_ascii=False)}

    return EventSourceResponse(event_generator())


# ---------------------------------------------------------------------------
# Re-index — scan the knowledge directory and rebuild everything
# ---------------------------------------------------------------------------


@app.post("/reindex", dependencies=[Depends(_verify_internal_token)])
@app.get("/reindex", dependencies=[Depends(_verify_internal_token)])
def reindex() -> dict[str, Any]:
    """Rebuild the whole index from the knowledge directory (POST preferred, GET kept for compatibility)."""
    try:
        result = pipeline.index_documents()
        return result
    except Exception:
        logger.exception("Re-index failed")
        raise HTTPException(status_code=500, detail="全量重建索引失败，请检查服务端日志")


# ---------------------------------------------------------------------------
# Process single file
# ---------------------------------------------------------------------------


@app.post("/process", response_model=ProcessResponse, dependencies=[Depends(_verify_internal_token)])
def process(body: ProcessRequest) -> dict[str, Any]:
    """Index one document after validating file_path is within allowed directories."""
    validated = _validate_file_path(body.file_path)
    try:
        if body.persist:
            result = pipeline.import_document(
                source_path=str(validated),
                category=body.category,
            )
        else:
            result = pipeline.add_document(
                file_path=str(validated),
                doc_id=body.doc_id,
            )
        return result
    except HTTPException:
        raise
    except Exception:
        logger.exception("Process document failed")
        raise HTTPException(status_code=500, detail="文档解析入库失败，请检查服务端日志")


@app.delete("/document/{doc_id}", dependencies=[Depends(_verify_internal_token)])
def delete_document(doc_id: str, delete_file: bool = True) -> dict[str, Any]:
    """Remove a document from the index and from the knowledge directory."""
    try:
        result = pipeline.remove_document(doc_id, delete_file=delete_file)
        return result
    except Exception:
        logger.exception("Delete document failed")
        raise HTTPException(status_code=500, detail="删除索引文档失败，请检查服务端日志")


# ---------------------------------------------------------------------------
# Index state / incremental sync / full rebuild
# ---------------------------------------------------------------------------


@app.get(
    "/index/state",
    response_model=IndexStateResponse,
    dependencies=[Depends(verify_internal_token)],
)
async def index_state() -> dict[str, Any]:
    """返回当前索引中的全部 doc_id、文档数、切片数及就绪状态。"""
    try:
        return await run_in_threadpool(pipeline.get_index_state)
    except Exception:
        logger.exception("Get index state failed")
        raise HTTPException(status_code=500, detail="获取索引状态失败，请检查服务端日志")


@app.post(
    "/index/sync",
    response_model=IndexSyncResponse,
    dependencies=[Depends(verify_internal_token)],
)
async def index_sync(body: IndexSyncRequest) -> dict[str, Any]:
    """增量同步索引：批量删除旧切片并合并向量化待新增/更新文档。"""
    try:
        upsert_docs = [item.model_dump() for item in body.upsert]
        return await run_in_threadpool(
            pipeline.sync_index,
            upsert=upsert_docs,
            delete_doc_ids=body.delete_doc_ids,
        )
    except Exception:
        logger.exception("Incremental index sync failed")
        raise HTTPException(status_code=500, detail="增量同步索引失败，请检查服务端日志")


@app.post(
    "/index/rebuild",
    response_model=IndexSyncResponse,
    dependencies=[Depends(verify_internal_token)],
)
async def index_rebuild(body: IndexRebuildRequest) -> dict[str, Any]:
    """基于权威文档列表全量重建 FAISS 与 BM25 索引。"""
    try:
        docs = [item.model_dump() for item in body.documents]
        return await run_in_threadpool(pipeline.rebuild_index, documents=docs)
    except Exception:
        logger.exception("Full index rebuild failed")
        raise HTTPException(status_code=500, detail="全量重建索引失败，请检查服务端日志")


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------


@app.get("/stats", dependencies=[Depends(verify_internal_token)])
def stats() -> dict[str, Any]:
    try:
        return pipeline.get_stats()
    except Exception:
        logger.exception("Get stats failed")
        raise HTTPException(status_code=500, detail="获取统计信息失败")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("AI_SERVICE_HOST", "127.0.0.1")
    port = int(os.environ.get("AI_SERVICE_PORT", "8003"))
    uvicorn.run("main:app", host=host, port=port, reload=False)
