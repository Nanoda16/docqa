"""DocQA AI 微服务核心 RAG 引擎单元测试（纯离线，无需下载大模型权重）。"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi import HTTPException

AI_DIR = Path(__file__).resolve().parent.parent
if str(AI_DIR) not in sys.path:
    sys.path.insert(0, str(AI_DIR))

from engine import embedding, loader  # noqa: E402
from engine.bm25_retriever import BM25Retriever  # noqa: E402
from engine.citation import validate_citations  # noqa: E402
from engine.fusion import rrf_fuse  # noqa: E402
from engine.pipeline import RAGPipeline  # noqa: E402
from engine.vector_store import VectorStore  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import main as ai_main  # noqa: E402
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


def _deterministic_embed_texts(texts):
    """生成确定性单位向量，用于纯离线测试批量向量化。"""
    if isinstance(texts, str):
        texts = [texts]
    dim = 16
    vecs = np.zeros((len(texts), dim), dtype=np.float32)
    for i, t in enumerate(texts):
        # 根据文本特征分配确定性方向并归一化
        seed = sum(ord(ch) for ch in t) % dim
        vecs[i, seed] = 1.0
        vecs[i, (seed + 3) % dim] = 0.5
        norm = float(np.linalg.norm(vecs[i]))
        if norm > 0:
            vecs[i] /= norm
    return vecs


def test_short_document_loader_and_empty_bm25_cleanup(tmp_path):
    """验证 <50 字节短文档不再被静默丢弃，且空语料保存会清理旧 BM25 磁盘文件。"""
    kdir = tmp_path / "kdocs"
    kdir.mkdir()
    short_file = kdir / "short.txt"
    short_file.write_text("短文本测试", encoding="utf-8")  # 15 bytes < 50
    empty_file = kdir / "blank.md"
    empty_file.write_text("   \n\t  ", encoding="utf-8")

    docs = loader.load_knowledge_docs(str(kdir))
    assert len(docs) == 1
    assert docs[0]["content"] == "短文本测试"

    bm25_dir = tmp_path / "bm25"
    bm25 = BM25Retriever()
    bm25.build(["测试语料一句话"], ["doc1_0"])
    bm25.save(str(bm25_dir))
    assert (bm25_dir / "bm25.pkl").is_file()
    assert (bm25_dir / "meta.json").is_file()

    bm25.build([], [])
    bm25.save(str(bm25_dir))
    assert not (bm25_dir / "bm25.pkl").exists()
    assert not (bm25_dir / "meta.json").exists()


def test_index_sync_lifecycle_and_reload(tmp_path, monkeypatch):
    """覆盖增量 /index/sync（新增含短文档 -> 更新 -> 删除）、/index/state 与重启重载不复活。"""
    data_dir = tmp_path / "data"
    monkeypatch.setenv("AI_DATA_DIR", str(data_dir))
    monkeypatch.setenv("INTERNAL_API_TOKEN", "test-secret-token")

    embed_calls: list[list[str]] = []

    def fake_embed_texts(texts):
        embed_calls.append(list(texts))
        return _deterministic_embed_texts(texts)

    monkeypatch.setattr(embedding, "embed_texts", fake_embed_texts)

    isolated_pipeline = RAGPipeline()
    monkeypatch.setattr(ai_main, "pipeline", isolated_pipeline)
    client = TestClient(ai_main.app)
    headers = {"X-Internal-Token": "test-secret-token"}

    # 未携带内部 Token 必须被拦截
    assert client.get("/index/state").status_code == 403

    # 1. 增量新增 2 篇（含 1 篇不足 50 字节的短文档）+ 1 篇空文档容错
    short_text = "短文档43字节以内测试"  # UTF-8 30 bytes < 50
    assert len(short_text.encode("utf-8")) < 50
    res_add = client.post(
        "/index/sync",
        headers=headers,
        json={
            "upsert": [
                {
                    "doc_id": "doc_1",
                    "title": "短文档标题",
                    "content": short_text,
                    "category": "general",
                },
                {
                    "doc_id": "doc_2",
                    "title": "报销规范",
                    "content": "差旅报销需在行程结束后十五个工作日内提交审批。",
                    "category": "finance",
                },
                {
                    "doc_id": "doc_empty",
                    "title": "空文档",
                    "content": "   ",
                    "category": "general",
                },
            ],
            "delete_doc_ids": [],
        },
    )
    assert res_add.status_code == 200
    body_add = res_add.json()
    assert {item["doc_id"] for item in body_add["upserted"]} == {"doc_1", "doc_2"}
    assert body_add["failed"] == [{"doc_id": "doc_empty", "error": "文档内容为空"}]
    assert body_add["deleted_count"] == 0
    assert body_add["total_docs"] == 2
    assert body_add["total_chunks"] == 2
    # 验证批量向量化仅调用了 1 次
    assert len(embed_calls) == 1
    assert len(embed_calls[0]) == 2

    state1 = client.get("/index/state", headers=headers).json()
    assert state1 == {
        "doc_ids": ["doc_1", "doc_2"],
        "doc_count": 2,
        "chunk_count": 2,
        "ready": True,
    }
    # 验证 chunk_id 元数据已正确写入
    assert all("chunk_id" in m for m in isolated_pipeline.vector_store.metadata)

    # 2. 更新 doc_2 内容（先删旧 chunk 再入库新 chunk）
    res_upd = client.post(
        "/index/sync",
        headers=headers,
        json={
            "upsert": [
                {
                    "doc_id": "doc_2",
                    "title": "报销规范v2",
                    "content": "更新版差旅报销规范：二十个工作日内完成线上归档审批。",
                    "category": "finance",
                }
            ],
            "delete_doc_ids": [],
        },
    )
    assert res_upd.status_code == 200
    body_upd = res_upd.json()
    assert body_upd["upserted"] == [{"doc_id": "doc_2", "chunk_count": 1}]
    assert body_upd["deleted_count"] == 0
    assert body_upd["total_docs"] == 2
    assert body_upd["total_chunks"] == 2
    # 确认旧内容已被移除、新内容已生效
    doc2_metas = [
        m for m in isolated_pipeline.vector_store.metadata if m["doc_id"] == "doc_2"
    ]
    assert len(doc2_metas) == 1
    assert "二十个工作日" in doc2_metas[0]["content"]
    assert "十五个工作日" not in doc2_metas[0]["content"]

    # 3. 删除 doc_1
    res_del = client.post(
        "/index/sync",
        headers=headers,
        json={"upsert": [], "delete_doc_ids": ["doc_1"]},
    )
    assert res_del.status_code == 200
    body_del = res_del.json()
    assert body_del["deleted_count"] == 1
    assert body_del["total_docs"] == 1
    assert body_del["total_chunks"] == 1

    state2 = client.get("/index/state", headers=headers).json()
    assert state2 == {
        "doc_ids": ["doc_2"],
        "doc_count": 1,
        "chunk_count": 1,
        "ready": True,
    }

    # 4. 模拟服务重启：新实例化 RAGPipeline 验证重载不复活已删文档 doc_1
    reloaded = RAGPipeline()
    reloaded_state = reloaded.get_index_state()
    assert reloaded_state == {
        "doc_ids": ["doc_2"],
        "doc_count": 1,
        "chunk_count": 1,
        "ready": True,
    }
    assert reloaded.bm25_retriever.count == 1
    assert reloaded.bm25_retriever.retrieve("短文档43字节", top_k=5) == []
    bm25_hits = reloaded.bm25_retriever.retrieve("二十个工作日", top_k=5)
    assert bm25_hits and bm25_hits[0][0] == "doc_2_0"


def test_index_rebuild_empty_clears_disk_and_reloads_zero_docs(tmp_path, monkeypatch):
    """验证 /index/rebuild 传空列表后清空磁盘索引，重启重载安全返回 0 篇。"""
    data_dir = tmp_path / "data"
    monkeypatch.setenv("AI_DATA_DIR", str(data_dir))
    monkeypatch.setenv("INTERNAL_API_TOKEN", "")
    monkeypatch.setattr(
        embedding, "embed_texts", lambda texts: _deterministic_embed_texts(texts)
    )

    isolated_pipeline = RAGPipeline()
    monkeypatch.setattr(ai_main, "pipeline", isolated_pipeline)
    client = TestClient(ai_main.app)

    # 先通过 /index/rebuild 写入 1 篇文档
    res_init = client.post(
        "/index/rebuild",
        json={
            "documents": [
                {
                    "doc_id": "doc_a",
                    "title": "制度A",
                    "content": "全量重建测试文档内容",
                    "category": "policy",
                }
            ]
        },
    )
    assert res_init.status_code == 200
    assert res_init.json()["total_docs"] == 1
    assert (data_dir / "faiss.index").is_file()
    assert (data_dir / "metadata.json").is_file()
    assert (data_dir / "bm25" / "bm25.pkl").is_file()

    # 再传空列表调用 /index/rebuild
    res_empty = client.post("/index/rebuild", json={"documents": []})
    assert res_empty.status_code == 200
    body_empty = res_empty.json()
    assert body_empty == {
        "upserted": [],
        "failed": [],
        "deleted_count": 1,
        "total_docs": 0,
        "total_chunks": 0,
    }

    # 磁盘旧索引文件必须全部清理
    assert not (data_dir / "faiss.index").exists()
    assert not (data_dir / "metadata.json").exists()
    assert not (data_dir / "bm25" / "bm25.pkl").exists()
    assert not (data_dir / "bm25" / "meta.json").exists()

    # 重启新实例安全返回 0 篇
    reloaded = RAGPipeline()
    assert reloaded.get_index_state() == {
        "doc_ids": [],
        "doc_count": 0,
        "chunk_count": 0,
        "ready": False,
    }
    assert reloaded.bm25_retriever.count == 0
    assert reloaded.vector_store.metadata == []
