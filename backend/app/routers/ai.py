"""RAG 问答 API 路由 — 对接 ai_service"""

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.deps import get_current_user_id, require_admin, success_response
from app.services.rag_service import RAGService

router = APIRouter(prefix="/api/ai", tags=["RAG 问答"])
_success = success_response
_get_current_user = get_current_user_id
_require_admin = require_admin


# ─── 请求 / 响应模型 ───────────────────────────────────


class QueryRequest(BaseModel):
    question: str
    top_k: int = 5


# ─── 端点 ──────────────────────────────────────────────


@router.post("/query")
async def query(
    data: QueryRequest,
    user_id: int = Depends(_get_current_user),
):
    """RAG 问答查询"""
    try:
        result = await RAGService.query(question=data.question, top_k=data.top_k)
        return _success(data=result, message="查询成功")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI 服务调用失败: {e}")


@router.get("/query/stream")
async def query_stream(
    question: str,
    top_k: int = 5,
    history: str = "",
    user_id: int = Depends(_get_current_user),
):
    """真 SSE 实时流式 RAG 问答查询（收到上游事件立即透传，消除假流式攒批延迟）"""
    parsed_history: list[dict] = []
    if history:
        try:
            raw = json.loads(history)
            if isinstance(raw, list):
                parsed_history = [
                    {"role": t.get("role", ""), "content": t.get("content", "")}
                    for t in raw
                    if isinstance(t, dict)
                ]
        except (ValueError, TypeError):
            parsed_history = []

    async def event_generator():
        try:
            async for event in RAGService.query_stream(
                question=question, top_k=top_k, history=parsed_history
            ):
                yield f"data: {event}\n\n"
        except Exception as exc:
            err_payload = json.dumps({"message": f"AI 流式服务异常: {exc}"}, ensure_ascii=False)
            yield f"event: error\ndata: {err_payload}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/reindex")
async def reindex(_=Depends(_require_admin)):
    """触发全量重新索引（管理员权限）"""
    try:
        result = await RAGService.reindex()
        return _success(data=result, message="重新索引已触发")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI 服务调用失败: {e}")


@router.get("/stats")
async def stats(_=Depends(_require_admin)):
    """获取知识库统计信息（管理员权限）"""
    try:
        result = await RAGService.stats()
        return _success(data=result, message="获取统计成功")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI 服务调用失败: {e}")
