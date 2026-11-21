"""RAG 问答与索引同步服务 — ai_service HTTP 客户端"""

import httpx

from app.config import settings


def _internal_headers() -> dict[str, str]:
    if settings.INTERNAL_API_TOKEN:
        return {"X-Internal-Token": settings.INTERNAL_API_TOKEN}
    return {}


class RAGService:
    """封装与 ai_service 的 HTTP 通信"""

    @staticmethod
    def _base_url() -> str:
        return settings.AI_SERVICE_URL.rstrip("/")

    @staticmethod
    async def query(question: str, top_k: int = 5, history: list[dict] | None = None) -> dict:
        """调用 ai_service /query 端点获取 RAG 问答结果"""
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{RAGService._base_url()}/query",
                json={"question": question, "top_k": top_k, "history": history or []},
                headers=_internal_headers(),
            )
            resp.raise_for_status()
            return resp.json()

    @staticmethod
    async def query_stream(question: str, top_k: int = 5, history: list[dict] | None = None):
        """调用 ai_service /query/stream 端点，逐行 yield SSE 事件"""
        import json

        params: dict = {"question": question, "top_k": top_k}
        if history:
            params["history"] = json.dumps(history, ensure_ascii=False)
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "GET",
                f"{RAGService._base_url()}/query/stream",
                params=params,
                headers=_internal_headers(),
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if line.startswith("data:"):
                        yield line[5:].lstrip(" ")

    @staticmethod
    async def reindex() -> dict:
        """触发 ai_service 全量重新索引（旧兼容入口）"""
        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.post(
                f"{RAGService._base_url()}/reindex",
                headers=_internal_headers(),
            )
            resp.raise_for_status()
            return resp.json()

    @staticmethod
    async def stats() -> dict:
        """获取知识库统计信息"""
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{RAGService._base_url()}/stats",
                headers=_internal_headers(),
            )
            resp.raise_for_status()
            return resp.json()

    @staticmethod
    async def process_file(file_path: str) -> dict:
        """提交文件路径给 ai_service 处理"""
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{RAGService._base_url()}/process",
                json={"file_path": file_path},
                headers=_internal_headers(),
            )
            resp.raise_for_status()
            return resp.json()

    @staticmethod
    def get_index_state(timeout: float = 5.0) -> dict:
        """获取 ai_service 当前向量索引状态（doc_ids / doc_count / chunk_count / ready）。"""
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(
                f"{RAGService._base_url()}/index/state",
                headers=_internal_headers(),
            )
            resp.raise_for_status()
            return resp.json()

    @staticmethod
    def sync_index(
        upsert: list[dict],
        delete_doc_ids: list[str],
        timeout: float = 600.0,
    ) -> dict:
        """调用 ai_service POST /index/sync 执行增量索引同步。"""
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(
                f"{RAGService._base_url()}/index/sync",
                json={"upsert": upsert, "delete_doc_ids": delete_doc_ids},
                headers=_internal_headers(),
            )
            resp.raise_for_status()
            return resp.json()

    @staticmethod
    def rebuild_index(documents: list[dict], timeout: float = 600.0) -> dict:
        """调用 ai_service POST /index/rebuild 基于数据库文档全量重建索引。"""
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(
                f"{RAGService._base_url()}/index/rebuild",
                json={"documents": documents},
                headers=_internal_headers(),
            )
            resp.raise_for_status()
            return resp.json()

    @staticmethod
    def rebuild_index_from_directory() -> dict:
        """兼容旧方法：调用 ai_service /reindex。"""
        with httpx.Client(timeout=600) as client:
            resp = client.post(
                f"{RAGService._base_url()}/reindex",
                headers=_internal_headers(),
            )
            resp.raise_for_status()
            return resp.json()

    @staticmethod
    def delete_doc(doc_id: str, keep_file: bool = False) -> dict:
        """通知 ai_service 删除索引条目。"""
        with httpx.Client(timeout=30) as client:
            resp = client.delete(
                f"{RAGService._base_url()}/document/{doc_id}",
                params={"delete_file": not keep_file},
                headers=_internal_headers(),
            )
            resp.raise_for_status()
            return resp.json()
