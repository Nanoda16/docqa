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
    """P0 修复验证：寒暄检测不得误杀含 hi 子串的英文词或带礼貌用语的正常业务问题。"""
    assert RAGPipeline._is_small_talk("你好") is True
    assert RAGPipeline._is_small_talk("Hi!") is True
    assert RAGPipeline._is_small_talk("谢谢！") is True

    # 下列正常提问绝对不能被寒暄短路拦截
    assert RAGPipeline._is_small_talk("history of release policy") is False
    assert RAGPipeline._is_small_talk("which api supports streaming") is False
    assert RAGPipeline._is_small_talk("你好，请问报销审批流程是什么？") is False
    assert RAGPipeline._is_small_talk("版本发布规范是什么？谢谢") is False


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
            "差旅报销单需在行程结束后十五个工作日内提交财务审批。",
            "生产环境发布前必须通过自动化回归测试并完成双人复核。",
            "内部微服务接口统一使用请求头令牌进行身份校验。",
        ],
        chunk_ids=["d1_0", "d2_0", "d3_0"],
    )
    sparse = bm25.retrieve("差旅报销审批期限", top_k=3)
    assert sparse and sparse[0][0] == "d1_0"

    dense = [
        {"doc_id": "d1", "chunk_index": 0, "score": 0.85, "content": "差旅报销审批"},
        {"doc_id": "d2", "chunk_index": 0, "score": 0.40, "content": "生产环境发布"},
    ]
    fused = rrf_fuse(dense, sparse, k=60.0, top_k=3)
    assert fused[0][0] == "d1_0"


def test_citation_validator_strips_hallucinated_refs():
    """验证引用后校验会保留合法 [S1] 并剔除越界幻觉引用 [S9]。"""
    chunks = [{"doc_id": "d1", "title": "报销管理规范", "content": "15 个工作日内提交"}]
    res = validate_citations("差旅报销需在 15 个工作日内提交[S1]，超期自动驳回[S9]。", chunks)
    assert res["invalid_count"] == 1
    assert "[S1]" in res["answer"]
    assert "[S9]" not in res["answer"]


def test_process_file_path_rejects_outside_whitelist():
    """P0 安全：ai_service /process 必须拦截 knowledge_docs 与 uploads 之外的任意路径。"""
    with pytest.raises(HTTPException) as exc:
        _validate_file_path("/etc/passwd")
    assert exc.value.status_code == 403
