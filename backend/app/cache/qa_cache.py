"""问答缓存 - Redis 缓存核心逻辑"""

import hashlib
import json
from datetime import datetime

from app.config import settings
from app.redis_client import redis_client

PREFIX = settings.CACHE_KEY_PREFIX


class QACache:
    """问答缓存服务"""

    @staticmethod
    def _make_qa_key(user_id: int, question: str) -> str:
        """生成问答缓存 key: doc:qa:qa:{user_id}:{question_short}:{hash_short}"""
        q_hash = hashlib.md5(question.encode("utf-8")).hexdigest()
        question_short = question[:30].replace(":", "_")
        q_hash_short = q_hash[:8]
        return f"{PREFIX}qa:{user_id}:{question_short}:{q_hash_short}"

    @staticmethod
    def _make_session_key(session_id: str) -> str:
        """生成会话缓存 key: doc:qa:session:{session_id}"""
        return f"{PREFIX}session:{session_id}"

    @staticmethod
    def _make_hot_key() -> str:
        """生成热数据统计 key"""
        return f"{PREFIX}hot:questions"

    @staticmethod
    def get_cached_answer(user_id: int, question: str) -> dict | None:
        """获取缓存的问答结果，返回 {"answer": str, "sources": list}"""
        try:
            key = QACache._make_qa_key(user_id, question)
            raw = redis_client.get(key)
            if not raw:
                return None
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, dict) and "answer" in parsed:
                    sources = parsed.get("sources")
                    return {
                        "answer": str(parsed.get("answer") or ""),
                        "sources": sources if isinstance(sources, list) else [],
                    }
            except (ValueError, TypeError):
                pass
            # 兼容旧版纯文本缓存
            return {"answer": str(raw), "sources": []}
        except Exception:
            pass
        return None

    @staticmethod
    def set_cached_answer(
        user_id: int,
        question: str,
        answer: str,
        sources: list | None = None,
        ttl: int | None = None,
    ) -> None:
        """将优质问答结果序列化为 JSON 写入缓存"""
        try:
            key = QACache._make_qa_key(user_id, question)
            payload = json.dumps(
                {"answer": answer, "sources": sources or []},
                ensure_ascii=False,
            )
            expire = ttl if ttl is not None else max(settings.CACHE_EXPIRE_SECONDS, 3600)
            redis_client.setex(key, expire, payload)
        except Exception:
            pass

    @staticmethod
    def delete_cached_answer(user_id: int, question: str) -> bool:
        """精准删除单条问答缓存，不存在时安全返回 False"""
        try:
            key = QACache._make_qa_key(user_id, question)
            deleted = redis_client.delete(key)
            return bool(deleted and int(deleted) > 0)
        except Exception:
            return False

    @staticmethod
    def get_session_history(session_id: str) -> list[dict] | None:
        """获取缓存的会话历史"""
        try:
            key = QACache._make_session_key(session_id)
            data = redis_client.lrange(key, 0, -1)
            if data:
                return [json.loads(item) for item in data]
        except Exception:
            pass
        return None

    @staticmethod
    def append_to_session(
        session_id: str, question: str, answer: str
    ) -> None:
        """追加记录到会话缓存"""
        try:
            key = QACache._make_session_key(session_id)
            entry = json.dumps(
                {
                    "question": question,
                    "answer": answer,
                    "timestamp": datetime.now().isoformat(),
                },
                ensure_ascii=False,
            )
            redis_client.rpush(key, entry)
            # 设置会话缓存过期时间（7天）
            redis_client.expire(key, 604800)
        except Exception:
            pass

    @staticmethod
    def clear_session(session_id: str) -> None:
        """清除会话缓存"""
        try:
            key = QACache._make_session_key(session_id)
            redis_client.delete(key)
        except Exception:
            pass

    @staticmethod
    def increment_hot_count(question: str) -> None:
        """增加问题的热门计数"""
        try:
            key = QACache._make_hot_key()
            redis_client.zincrby(key, 1, question)
            # 热数据统计保留 7 天
            redis_client.expire(key, 604800)
        except Exception:
            pass

    @staticmethod
    def get_hot_questions(limit: int = 10) -> list[dict]:
        """获取热门问题列表"""
        try:
            key = QACache._make_hot_key()
            results = redis_client.zrevrange(key, 0, limit - 1, withscores=True)
            return [
                {"question": q, "count": int(c)} for q, c in results
            ]
        except Exception:
            return []

    @staticmethod
    def clear_qa_cache() -> int:
        """清空所有 Q&A 问答结果缓存（索引同步或重建后调用）"""
        deleted = 0
        try:
            pattern = f"{PREFIX}qa:*"
            cursor = 0
            keys: list[str] = []
            while True:
                cursor, batch = redis_client.scan(cursor=cursor, match=pattern, count=500)
                keys.extend(batch)
                if cursor == 0:
                    break
            if keys:
                deleted = int(redis_client.delete(*keys) or 0)
        except Exception:
            pass
        return deleted
