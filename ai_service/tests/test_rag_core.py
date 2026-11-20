"""CampusQA AI 微服务核心 RAG 引擎单元测试（纯离线，无需下载大模型权重）。"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi import HTTPException

AI_DIR = Path(__file__).resolve().parent.parent
if str(AI_DIR) not in sys.path:
    sys.path.insert(0, str(AI_DIR))

from engine.bm25_retriever import BM25Retriever  # noqa: E402
from engine.citation import validate_citations  # noqa: E402
from engine.fusion import rrf_fuse  # noqa: E402
from engine.pipeline import RAGPipeline  # noqa: E402
from engine.vector_store import VectorStore  # noqa: E402
from main import _validate_file_path  # noqa: E402


def test_small_talk_does_not_falsely_trigger_on_domain_queries():
    """P0 修复验证：寒暄检测不得误杀含 hi 子串的英文词或带礼貌用语的正常校园问题。"""
    assert RAGPipeline._is_small_talk("你好") is True
    assert RAGPipeline._is_small_talk("Hi!") is True
    assert RAGPipeline._is_small_talk("谢谢！") is True

    # 下列正常提问绝对不能被寒暄短路拦截
    assert RAGPipeline._is_small_talk("history of the university") is False
    assert RAGPipeline._is_small_talk("which library is open") is False
    assert RAGPipeline._is_small_talk("你好，请问图书馆几点开门？") is False
    assert RAGPipeline._is_small_talk("转专业政策是什么？谢谢") is False


def test_vector_store_delete_last_doc_and_reload_safe(tmp_path, monkeypatch):
    """P0 修复验证：删除最后一篇文档后落盘重启不得因旧 faiss.index 残留而崩溃。"""
    monkeypatch.setenv("AI_DATA_DIR", str(tmp_path))
    vs = VectorStore()
    vecs = np.array([[1.0, 0.0, 0.0, 0.0]], dtype=np.float32)
    meta = [{"doc_id": "doc1", "chunk_index": 0, "content": "测试文档", "title": "T"}]
    vs.build(vecs, meta)
    vs.save()

    assert vs.delete("doc1") == 1
    vs.save()

    # 重启新实例加载，必须安全返回空索引而非 IndexError
    vs2 = VectorStore()
    assert vs2.load() is False
    assert vs2.search(vecs[0], top_k=3) == []


def test_bm25_and_rrf_fusion():
    """验证 BM25 中文分词检索与 RRF 多路融合排序正确性。"""
    bm25 = BM25Retriever()
    bm25.build(
        corpus=[
            "河海大学图书馆每天早上八点开放，晚上十点闭馆。",
            "本科生转专业申请需在每年春季学期第二周提交教务处。",
            "计算机与软件学院设有软件工程和人工智能专业。",
        ],
        chunk_ids=["d1_0", "d2_0", "d3_0"],
    )
    sparse = bm25.retrieve("图书馆开放时间", top_k=3)
    assert sparse and sparse[0][0] == "d1_0"

    dense = [
        {"doc_id": "d1", "chunk_index": 0, "score": 0.85, "content": "图书馆开放"},
        {"doc_id": "d2", "chunk_index": 0, "score": 0.40, "content": "转专业"},
    ]
    fused = rrf_fuse(dense, sparse, k=60.0, top_k=3)
    assert fused[0][0] == "d1_0"


def test_citation_validator_strips_hallucinated_refs():
    """验证引用后校验会保留合法 [S1] 并剔除越界幻觉引用 [S9]。"""
    chunks = [{"doc_id": "d1", "title": "图书馆指南", "content": "8:00 开放"}]
    res = validate_citations("图书馆早上八点开放[S1]，周末延长[S9]。", chunks)
    assert res["invalid_count"] == 1
    assert "[S1]" in res["answer"]
    assert "[S9]" not in res["answer"]


def test_process_file_path_rejects_outside_whitelist():
    """P0 安全：ai_service /process 必须拦截 knowledge_docs 与 uploads 之外的任意路径。"""
    with pytest.raises(HTTPException) as exc:
        _validate_file_path("/etc/passwd")
    assert exc.value.status_code == 403
