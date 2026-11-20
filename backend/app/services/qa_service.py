"""问答记录业务服务"""

from sqlalchemy.orm import Session

from app.models.qa_record import QARecord
from app.schemas.qa_record import QARecordCreate


class QAService:
    """问答记录服务"""

    @staticmethod
    def create(db: Session, data: QARecordCreate) -> QARecord:
        """创建问答记录"""
        record = QARecord(
            user_id=data.user_id,
            session_id=data.session_id,
            question=data.question,
            answer=data.answer,
            sources=data.sources,
            tokens_used=data.tokens_used,
            duration_ms=data.duration_ms,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record

    @staticmethod
    def get_by_id(db: Session, record_id: int) -> QARecord | None:
        """根据ID获取记录"""
        return db.query(QARecord).filter(QARecord.id == record_id).first()

    @staticmethod
    def get_session_history(
        db: Session,
        session_id: str,
        page: int = 1,
        page_size: int = 50,
        user_id: int | None = None,
    ) -> tuple[list[QARecord], int]:
        """获取指定会话的历史记录（传入 user_id 时强制隔离归属权）"""
        query = db.query(QARecord).filter(QARecord.session_id == session_id)
        if user_id is not None:
            query = query.filter(QARecord.user_id == user_id)
        total = query.count()
        records = (
            query.order_by(QARecord.created_at.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return records, total

    @staticmethod
    def get_user_history(
        db: Session,
        user_id: int,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[QARecord], int]:
        """获取用户的历史记录"""
        query = (
            db.query(QARecord)
            .filter(QARecord.user_id == user_id)
        )
        total = query.count()
        records = (
            query.order_by(QARecord.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return records, total

    @staticmethod
    def get_user_sessions(
        db: Session,
        user_id: int,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[dict], int]:
        """获取用户的所有会话列表（按最新时间倒序，并取时间上最新的一条提问作为标题）"""
        from sqlalchemy import func as sa_func

        # 按 session_id 汇总最新时间、最大记录 ID 与条数
        subquery = (
            db.query(
                QARecord.session_id.label("session_id"),
                sa_func.max(QARecord.created_at).label("last_time"),
                sa_func.count(QARecord.id).label("msg_count"),
                sa_func.max(QARecord.id).label("latest_id"),
            )
            .filter(
                QARecord.user_id == user_id,
                QARecord.session_id.isnot(None),
            )
            .group_by(QARecord.session_id)
            .subquery()
        )

        total = db.query(subquery).count()
        rows = (
            db.query(
                subquery.c.session_id,
                subquery.c.last_time,
                subquery.c.msg_count,
                QARecord.question,
                QARecord.answer,
            )
            .join(QARecord, QARecord.id == subquery.c.latest_id)
            .order_by(subquery.c.last_time.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )

        result = []
        for sid, last_time, msg_count, question, answer in rows:
            result.append({
                "session_id": sid,
                "question_count": msg_count,
                "msg_count": msg_count,
                "last_question": question or "",
                "first_question": question or "",
                "last_answer": answer or "",
                "updated_at": last_time.isoformat() if last_time else "",
                "last_time": last_time,
            })
        return result, total

    @staticmethod
    def delete_session(db: Session, session_id: str, user_id: int | None = None) -> int:
        """删除指定会话的所有记录"""
        query = db.query(QARecord).filter(QARecord.session_id == session_id)
        if user_id is not None:
            query = query.filter(QARecord.user_id == user_id)
        deleted = query.delete(synchronize_session=False)
        db.commit()
        return deleted

    @staticmethod
    def update_feedback(
        db: Session, record_id: int, feedback: int, user_id: int | None = None
    ) -> QARecord | None:
        """更新问答反馈（校验记录归属权，防止 IDOR 越权篡改）"""
        if feedback not in (0, 1, 2):
            raise ValueError("feedback 必须是 0(无)、1(有用) 或 2(无用)")

        record = QAService.get_by_id(db, record_id)
        if not record:
            return None
        if user_id is not None and record.user_id != user_id:
            raise PermissionError("无权限评价他人问答记录")

        record.feedback = feedback
        db.commit()
        db.refresh(record)
        return record
