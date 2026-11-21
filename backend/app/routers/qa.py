"""问答记录 API 路由"""

import time

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.cache.qa_cache import QACache
from app.database import get_db
from app.schemas.qa_record import AnswerCreate, QARecordCreate, QARecordResponse
from app.services.qa_service import QAService
from app.routers.user import _get_current_user

router = APIRouter(prefix="/api/qa", tags=["问答记录"])


def _success(data=None, message="success"):
    return {
        "code": 200,
        "message": message,
        "data": data,
        "timestamp": int(time.time()),
    }


@router.post("/ask")
def ask_question(
    question: str = Query(..., description="用户问题"),
    session_id: str | None = Query(None, description="会话ID"),
    bypass_cache: bool = Query(False, description="是否跳过缓存重新检索"),
    user_id: int = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """提交问题：仅当未指定 bypass_cache 时优先查用户点赞确认的优质缓存；命中后仍落库一条记录以支持点赞/点踩与会话回溯。"""
    # 1. 查缓存
    cached = None if bypass_cache else QACache.get_cached_answer(user_id, question)
    if cached:
        record = QAService.create(
            db,
            QARecordCreate(
                user_id=user_id,
                session_id=session_id,
                question=question,
                answer=cached["answer"],
                sources=cached["sources"],
            ),
        )
        if session_id:
            QACache.append_to_session(session_id, question, cached["answer"])
        QACache.increment_hot_count(question)
        return _success(
            data={
                "id": record.id,
                "question": question,
                "answer": cached["answer"],
                "sources": cached["sources"],
                "from_cache": True,
                "session_id": session_id,
            },
            message="缓存命中",
        )

    # 2. 缓存未命中或跳过缓存，创建记录（answer 为空，由后续 RAG 引擎填充）
    record = QAService.create(
        db,
        QARecordCreate(
            user_id=user_id,
            session_id=session_id,
            question=question,
        ),
    )

    # 记录到会话缓存
    if session_id:
        QACache.append_to_session(session_id, question, "")

    QACache.increment_hot_count(question)

    return _success(
        data=QARecordResponse.model_validate(record).model_dump(),
        message="问题已提交，等待回答",
    )


@router.post("/answer")
def save_answer(
    data: AnswerCreate,
    user_id: int = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """保存AI回答（仅持久化数据库与会话历史，由用户点赞确认后才写入问答缓存）"""
    record = QAService.get_by_id(db, data.record_id)
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    if record.user_id != user_id:
        raise HTTPException(status_code=403, detail="无权限修改此记录")

    # 更新回答
    record.answer = data.answer
    if data.sources is not None:
        record.sources = data.sources
    record.tokens_used = data.tokens_used
    if data.duration_ms is not None:
        record.duration_ms = data.duration_ms
    db.commit()
    db.refresh(record)

    # 更新会话缓存
    if record.session_id:
        # 删除最后一条空回答，重新追加
        QACache.clear_session(record.session_id)
        # 重新加载该会话的所有记录到缓存
        records, _ = QAService.get_session_history(db, record.session_id, page_size=100)
        for r in records:
            if r.answer:
                QACache.append_to_session(record.session_id, r.question, r.answer)

    return _success(
        data=QARecordResponse.model_validate(record).model_dump(),
        message="回答已保存",
    )


@router.get("/history")
def get_history(
    page: int = 1,
    page_size: int = 20,
    user_id: int = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """获取会话列表（按session_id分组）"""
    sessions, total = QAService.get_user_sessions(
        db, user_id, page=page, page_size=page_size
    )
    return _success(
        data={
            "total": total,
            "items": sessions,
            "page": page,
            "page_size": page_size,
        }
    )


@router.get("/session/{session_id}")
def get_session_detail(
    session_id: str,
    page: int = 1,
    page_size: int = 50,
    user_id: int = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """获取单会话详情（仅返回当前登录用户的记录，防止 IDOR 越权读取）"""
    records, total = QAService.get_session_history(
        db, session_id, page=page, page_size=page_size, user_id=user_id
    )
    return _success(
        data={
            "total": total,
            "items": [QARecordResponse.model_validate(r).model_dump() for r in records],
            "page": page,
            "page_size": page_size,
            "session_id": session_id,
        }
    )


@router.delete("/session/{session_id}")
def delete_session(
    session_id: str,
    user_id: int = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """删除会话（仅当确实删除了属于自己的记录时才清除对应会话缓存）"""
    deleted = QAService.delete_session(db, session_id, user_id=user_id)
    if deleted > 0:
        QACache.clear_session(session_id)
    return _success(
        data={"deleted_count": deleted},
        message="会话已删除",
    )


@router.get("/hot")
def get_hot_questions(limit: int = 10):
    """获取热门问题"""
    questions = QACache.get_hot_questions(limit=limit)
    return _success(data={"questions": questions})


@router.post("/feedback")
def submit_feedback(
    record_id: int = Query(..., description="记录ID"),
    feedback: int = Query(..., description="反馈: 0=无, 1=有用, 2=无用"),
    user_id: int = Depends(_get_current_user),
    db: Session = Depends(get_db),
):
    """提交问答反馈：点赞写入缓存，点踩删除缓存"""
    try:
        record = QAService.update_feedback(db, record_id, feedback, user_id=user_id)
        if not record:
            raise HTTPException(status_code=404, detail="记录不存在")
        if feedback == 1:
            if record.answer and record.answer.strip():
                QACache.set_cached_answer(
                    record.user_id,
                    record.question,
                    record.answer,
                    sources=record.sources,
                )
                return _success(
                    data={"record_id": record.id, "feedback": 1, "cache_action": "cached"},
                    message="已点赞，回答已加入问答缓存",
                )
            return _success(
                data={"record_id": record.id, "feedback": 1, "cache_action": "none"},
                message="已点赞",
            )
        if feedback == 2:
            deleted = QACache.delete_cached_answer(record.user_id, record.question)
            return _success(
                data={
                    "record_id": record.id,
                    "feedback": 2,
                    "cache_action": "invalidated" if deleted else "none",
                },
                message="已记录反馈并从缓存移除" if deleted else "已记录反馈",
            )
        return _success(
            data={"record_id": record.id, "feedback": feedback, "cache_action": "none"},
            message="反馈已提交",
        )
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
