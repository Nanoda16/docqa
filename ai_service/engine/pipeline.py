"""
RAG pipeline — orchestrates the full retrieval-augmented generation workflow.

Connects Retriever → Prompts → Generator in a single callable interface,
with both synchronous and streaming modes, plus full indexing utilities.
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from typing import Any, Generator as GeneratorType

from . import chunker, embedding, loader, prompts
from .bm25_retriever import BM25Retriever
from .citation import validate_citations
from .fusion import rrf_fuse
from .generator import Generator
from .retriever import Retriever
from .vector_store import VectorStore, data_root

logger = logging.getLogger(__name__)


def _make_chunk_id(d: dict) -> str:
    """Build ``{doc_id}_{chunk_index}`` from a chunk dict."""
    doc_id = d.get("doc_id", "")
    chunk_idx = d.get("chunk_index", 0)
    return f"{doc_id}_{chunk_idx}"


# ---------------------------------------------------------------------------
# Hybrid retrieval depth
# ---------------------------------------------------------------------------
# Both the dense and the sparse retriever contribute ``_CANDIDATE_DEPTH``
# hits.  Their ranked lists are fused with RRF (reciprocal rank fusion) and
# only the top ``_FINAL_TOP_K`` chunks of the fused ranking are handed to the
# LLM.  Keeping the two numbers separate is what makes the fusion meaningful:
# the candidate pool has to be wider than the final context window.
_CANDIDATE_DEPTH = 5
_FINAL_TOP_K = 3
_RRF_K = 60.0


class RAGPipeline:
    """End-to-end RAG pipeline that orchestrates retrieval, prompt assembly,
    and LLM generation.

    Parameters
    ----------
    retriever : Retriever, optional
        Pre-configured retriever instance.  Created automatically from
        *vector_store* when omitted.
    generator : Generator, optional
        Pre-configured LLM generator instance.  Created automatically
        when omitted.
    vector_store : VectorStore, optional
        Pre-configured vector store instance.  When omitted a new one is
        created, which auto-loads persisted index files from disk if they
        exist.
    """

    def __init__(
        self,
        retriever: Retriever | None = None,
        generator: Generator | None = None,
        vector_store: VectorStore | None = None,
        bm25_retriever: BM25Retriever | None = None,
    ):
        self.vector_store = vector_store or VectorStore()
        self.retriever = retriever or Retriever(vector_store=self.vector_store)
        # The generator is built LAZILY.  Indexing and retrieval never need an
        # LLM, so requiring DEEPSEEK_API_KEY at construction time made
        # `cli.py --index` / `--rebuild` fail for no reason -- and because
        # --rebuild deleted the index *before* constructing the pipeline, the
        # project was left with no index at all.  See generator property below.
        self._generator: Generator | None = generator
        self.bm25_retriever = bm25_retriever or BM25Retriever()
        # Pipeline state: populated by query methods for downstream fusion
        self._lock = threading.Lock()
        self._bm25_results: list[tuple[str, float]] = []
        self._fused_results: list[tuple[str, float, list[float]]] = []

        # Reranker (lazy — only loaded when enabled and first used).
        # Off by default: the fused RRF order is the ranking this pipeline is
        # specified to return.  When the cross-encoder runs afterwards it
        # replaces that order with its own scores and truncates the list again,
        # so the fused ranking never reaches the prompt.
        self.reranker: Any | None = None
        self._reranker_enabled: bool = (
            os.environ.get("RERANKER_ENABLED", "false").lower() == "true"
        )
        self._reranker_top_k: int = _FINAL_TOP_K

        # Hybrid retrieval depth — candidates per retriever, final window.
        self._candidate_depth: int = _CANDIDATE_DEPTH
        self._final_top_k: int = _FINAL_TOP_K
        self._rrf_k: float = _RRF_K

        logger.info(
            "RAGPipeline initialised (reranker=%s, candidates=%d, final_top_k=%d)",
            "enabled" if self._reranker_enabled else "disabled",
            self._candidate_depth,
            self._final_top_k,
        )

        # BM25 is restored explicitly.  It used to be built only by the
        # indexing methods, so a process that started with an existing FAISS
        # index never had a sparse index at all and RRF fused the dense
        # ranking with an empty list.
        self._load_or_rebuild_bm25()

    # ------------------------------------------------------------------
    # Generator access (lazy — indexing/retrieval must work without an LLM)
    # ------------------------------------------------------------------

    @property
    def generator(self) -> Generator:
        """Return the LLM generator, constructing it on first use.

        The generator is built lazily so that indexing and retrieval work
        without ``DEEPSEEK_API_KEY`` (see ``__init__``).

        Raises
        ------
        RuntimeError
            When ``DEEPSEEK_API_KEY`` is absent.  Indexing and retrieval do not
            touch this property, so they work without a key.
        """
        if self._generator is None:
            self._generator = Generator()
        return self._generator

    @generator.setter
    def generator(self, value: Generator | None) -> None:
        """Allow injecting/replacing the generator after construction.

        Needed because this used to be a plain instance attribute
        (``self.generator = ...``).  Making it a read-only property broke
        every test that stubs it with ``pipeline.generator = MagicMock()``
        (``backend/tests/test_artifact.py``, ``backend/tests/test_rejection.py``).
        """
        self._generator = value

    def has_generator(self) -> bool:
        """True when answer generation is possible (API key present)."""
        try:
            return self.generator.available
        except RuntimeError:
            return False

    # ------------------------------------------------------------------
    # Sparse index persistence
    # ------------------------------------------------------------------

    @staticmethod
    def _bm25_dir() -> str:
        """Return the directory that holds the persisted BM25 index."""
        return os.path.join(data_root(), "bm25")

    def _load_or_rebuild_bm25(self) -> None:
        """Restore the sparse index, falling back to rebuilding it.

        The BM25 index has to exist before the first query, otherwise the
        sparse half of the hybrid retrieval contributes nothing.  Two sources
        are tried in order:

        1. the persisted pickle under ``data/bm25/``;
        2. a rebuild from :attr:`vector_store` metadata, which always mirrors
           the dense index.
        """
        if self.bm25_retriever.count > 0:
            return

        bm25_dir = self._bm25_dir()
        pkl_path = os.path.join(bm25_dir, "bm25.pkl")
        meta_path = os.path.join(bm25_dir, "meta.json")
        if os.path.isfile(pkl_path) and os.path.isfile(meta_path):
            try:
                self.bm25_retriever.load(bm25_dir)
            except Exception:
                logger.warning(
                    "Could not load BM25 index from %s — rebuilding from the "
                    "vector store instead",
                    bm25_dir,
                    exc_info=True,
                )
            if self.bm25_retriever.count > 0:
                return

        if self.vector_store.metadata:
            count = self._rebuild_bm25_from_vector_store()
            logger.info("Rebuilt BM25 index from vector store (%d chunks)", count)
        else:
            logger.info("BM25 index is empty — no vector store metadata yet")

    def _rebuild_bm25_from_vector_store(self) -> int:
        """Rebuild the sparse index from the dense store's chunk metadata.

        The vector store is the single source of truth for chunk text, so this
        keeps dense and sparse perfectly aligned.

        Returns
        -------
        int
            Number of chunks in the rebuilt index.
        """
        texts: list[str] = []
        chunk_ids: list[str] = []
        for meta in self.vector_store.metadata:
            content = meta.get("content") or ""
            if not content:
                continue
            texts.append(content)
            chunk_ids.append(_make_chunk_id(meta))

        self.bm25_retriever.build(texts, chunk_ids)
        self.bm25_retriever.save(self._bm25_dir())
        return len(texts)

    # ------------------------------------------------------------------
    # Rejection template
    # ------------------------------------------------------------------

    _REJECTION_TEMPLATE = "根据现有知识库，暂未找到关于「{question}」的可靠信息。"

    # ------------------------------------------------------------------
    # Small-talk detection
    # ------------------------------------------------------------------

    _GREETINGS = frozenset({
        "你好", "您好", "hi", "hello", "hey", "嗨", "哈喽", "在吗", "在不在",
        "谢谢", "感谢", "多谢", "谢谢你", "感谢你", "你是谁", "你叫什么",
        "你好呀", "你好啊", "早安", "早上好", "下午好", "晚上好",
    })
    _PUNCT_STRIP_RE = re.compile(r"[\s，。！？、,.!?;:~～]+")

    @staticmethod
    def _is_small_talk(query: str) -> bool:
        """Return True ONLY when *query* itself is a standalone greeting/chit-chat.

        Avoids substring false positives such as 'history'/'which' (containing 'hi')
        or polite domain questions like '你好，请问报销审批流程是什么？'.
        """
        q = RAGPipeline._PUNCT_STRIP_RE.sub("", query.strip().lower())
        if not q or len(q) > 12:
            return False
        return q in RAGPipeline._GREETINGS

    # ------------------------------------------------------------------
    # Reranker integration
    # ------------------------------------------------------------------

    def _rerank_chunks(self, query: str, chunks: list[dict]) -> list[dict]:
        """Re-rank retrieved chunks with the cross-encoder and keep top-N.

        Results are re-sorted by descending cross-encoder score.  A new
        ``rerank_score`` key is added to each chunk dict (the original
        ``score`` from dense retrieval is preserved).

        Returns
        -------
        list[dict]
            The top ``self._reranker_top_k`` chunks in reranker order.
            Returns the original list unchanged if the reranker model cannot
            be loaded.
        """
        if self.reranker is None:
            from .reranker import Reranker

            self.reranker = Reranker()

        candidates = [(_make_chunk_id(c), c["content"]) for c in chunks]
        reranked = self.reranker.rerank(query, candidates)

        # Build score lookup and re-sort.  The key must be the *chunk* id:
        # several chunks of the same document share a ``doc_id``, so keying on
        # ``doc_id`` kept only the last score and destroyed the per-chunk
        # reranking signal exactly where it matters most.
        score_map = {cid: score for cid, score in reranked}
        sorted_chunks = sorted(
            chunks,
            key=lambda c: score_map.get(_make_chunk_id(c), 0.0),
            reverse=True,
        )

        # Annotate with reranker score (preserving original score)
        for c in sorted_chunks:
            c["rerank_score"] = score_map.get(
                _make_chunk_id(c), c.get("score", 0.0)
            )

        return sorted_chunks[: self._reranker_top_k]

    def _materialize_fusion(
        self,
        dense_chunks: list[dict],
        fused_results: list[tuple[str, float, list[float]]],
    ) -> list[dict]:
        """Turn the fused ranking into chunk dicts, dense *and* sparse hits.

        ``rrf_fuse`` scores the union of both retrievers' results, but only the
        dense side carries metadata in memory.  Chunks that the sparse
        retriever surfaced are looked up in the vector store so they are not
        dropped — dropping them would reduce the "hybrid" retrieval to a mere
        re-ordering of the dense list.

        Parameters
        ----------
        dense_chunks : list[dict]
            Dense retriever result dicts.
        fused_results : list[tuple[str, float, list[float]]]
            Output from :func:`rrf_fuse`, sorted descending by fused score.

        Returns
        -------
        list[dict]
            Chunk dicts in fused order.  Each carries ``rrf_score``, plus
            ``dense_score``/``bm25_score`` for sparse-only hits (the dense
            results already expose their cosine similarity as ``score``).
        """
        dense_map = {_make_chunk_id(c): c for c in dense_chunks}

        sparse_only_ids = [
            cid for cid, _, _ in fused_results if cid not in dense_map
        ]
        sparse_meta = (
            self.vector_store.chunks_by_chunk_id(sparse_only_ids)
            if sparse_only_ids
            else {}
        )

        ordered: list[dict] = []
        seen: set[str] = set()
        for cid, fused_score, sources in fused_results:
            if cid in seen:
                continue

            if cid in dense_map:
                chunk = dict(dense_map[cid])
            elif cid in sparse_meta:
                chunk = dict(sparse_meta[cid])
                # No cosine similarity exists for a sparse-only hit, so do not
                # fabricate one: callers treat ``score`` as a 0..1 relevance.
                chunk["dense_score"] = sources[0]
                chunk["bm25_score"] = sources[1]
            else:
                continue  # stale BM25 entry with no matching chunk

            chunk["rrf_score"] = fused_score
            ordered.append(chunk)
            seen.add(cid)

        return ordered

    # ------------------------------------------------------------------
    # Sync pipeline
    # ------------------------------------------------------------------

    def run(
        self,
        query: str,
        top_k: int = 5,
        min_score: float = 0.0,
        temperature: float = 0.3,
        max_tokens: int = 1024,
        history: list[dict] | None = None,
    ) -> dict[str, Any]:
        """Run the full RAG pipeline synchronously.

        Parameters
        ----------
        query : str
            The user's question.
        top_k : int
            Candidate depth — how many hits each retriever contributes before
            fusion (default 5).  The fused ranking is truncated to
            ``_FINAL_TOP_K`` chunks, so fewer sources than this reach the LLM.
        min_score : float
            Minimum similarity score threshold (default 0.0).
        temperature : float
            LLM sampling temperature (default 0.3).
        max_tokens : int
            Maximum tokens in the generated response (default 1024).
        history : list[dict] | None
            Prior conversation turns for multi-turn context resolution.

        Returns
        -------
        dict
            ``{"answer": str, "sources": list[dict]}``.
            When no relevant documents are found the *answer* will be
            ``"未找到相关文档信息"`` and *sources* an empty list.
            When retrieval confidence is too low the *answer* will be a
            rejection message indicating the knowledge base does not contain
            reliable information on the query topic.
        """
        # 0. Greeting / small-talk shortcut — skip RAG entirely
        if self._is_small_talk(query):
            return {
                "answer": (
                    "你好！我是文档知识库问答助手。\n\n"
                    "你可以直接向我提问知识库中的内容，比如：\n"
                    "- 制度规范、业务流程、操作手册\n"
                    "- 技术文档、接口说明、架构设计\n"
                    "- 公告通知、常见问题与归档资料\n\n"
                    "直接告诉我你想了解什么就好。"
                ),
                "sources": [],
            }

        # 1-3. 在索引锁内完成双路检索与结果实体化，避免与并发索引重建交错
        with self._lock:
            depth = max(top_k, self._final_top_k)
            chunks = self.retriever.retrieve(query, depth, min_score)
            self._bm25_results = self.bm25_retriever.retrieve(query, depth)

            if not chunks and not self._bm25_results:
                logger.info("No relevant chunks found for query: %s", query[:60])
                return {"answer": "未找到相关文档信息", "sources": []}

            if getattr(self.retriever, "low_confidence", False):
                logger.info(
                    "OOD query rejected (low confidence): %s", query[:60]
                )
                return {
                    "answer": self._REJECTION_TEMPLATE.format(question=query),
                    "sources": [],
                }

            self._fused_results = rrf_fuse(
                chunks,
                self._bm25_results,
                k=self._rrf_k,
                top_k=len(chunks) + len(self._bm25_results),
            )
            logger.debug(
                "RRF fusion: %d dense + %d BM25 → %d fused results for query: %s",
                len(chunks), len(self._bm25_results), len(self._fused_results),
                query[:60],
            )
            materialized = self._materialize_fusion(chunks, self._fused_results)

        # 4. Optional cross-encoder rerank over full candidate pool, then truncate to final window
        if self._reranker_enabled and materialized:
            logger.debug("Reranking %d chunks for query: %s", len(materialized), query[:60])
            chunks = self._rerank_chunks(query, materialized)[: self._final_top_k]
        else:
            chunks = materialized[: self._final_top_k]

        # 3. Build prompt pair from retrieved chunks (+ optional history)
        system_prompt, user_prompt = prompts.build_prompt(query, chunks, history)

        # 4. Generate answer
        answer = self.generator.generate(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        # 4b. Post-process — remove invalid [Sx] citations
        validation = validate_citations(answer, chunks)
        if validation["invalid_count"] > 0:
            logger.info(
                "Removed %d invalid citation(s) from answer",
                validation["invalid_count"],
            )
        answer = validation["answer"]

        # 5. Structure output with source metadata
        return prompts.format_answer(answer, chunks)

    # ------------------------------------------------------------------
    # Streaming pipeline
    # ------------------------------------------------------------------

    def run_stream(
        self,
        query: str,
        top_k: int = 5,
        min_score: float = 0.0,
        temperature: float = 0.3,
        max_tokens: int = 1024,
        history: list[dict] | None = None,
    ) -> GeneratorType[dict[str, Any], None, None]:
        """Run the RAG pipeline with streaming token output.

        Yields intermediate event dicts so callers can display progress
        indicators, show retrieved sources, and stream the answer token
        by token to the user.

        Parameters
        ----------
        query : str
            The user's question.
        top_k : int
            Candidate depth — how many hits each retriever contributes before
            fusion (default 5).  The fused ranking is truncated to
            ``_FINAL_TOP_K`` chunks, so fewer sources than this reach the LLM.
        min_score : float
            Minimum similarity score threshold (default 0.0).
        temperature : float
            LLM sampling temperature (default 0.3).
        max_tokens : int
            Maximum tokens in the generated response (default 1024).

        Yields
        ------
        dict
            Event dicts with a ``"type"`` discriminator:

            - ``{"type": "status", "message": "检索中..."}``
            - ``{"type": "sources", "data": [...]}``
            - ``{"type": "token", "content": "..."}``
            - ``{"type": "done", "answer": "...", "sources": [...]}``
        """
        # 0. Greeting / small-talk shortcut
        if self._is_small_talk(query):
            yield {
                "type": "done",
                "answer": (
                    "你好！我是文档知识库问答助手。\n\n"
                    "你可以直接向我提问知识库中的内容，比如：\n"
                    "- 制度规范、业务流程、操作手册\n"
                    "- 技术文档、接口说明、架构设计\n"
                    "- 公告通知、常见问题与归档资料\n\n"
                    "直接告诉我你想了解什么就好。"
                ),
                "sources": [],
            }
            return

        # 1. Status — retrieval phase
        yield {"type": "status", "message": "检索中..."}

        # 2-3c. 在索引锁内完成双路检索与结果实体化，生成流式输出前释放锁
        with self._lock:
            depth = max(top_k, self._final_top_k)
            chunks = self.retriever.retrieve(query, depth, min_score)
            self._bm25_results = self.bm25_retriever.retrieve(query, depth)

            if not chunks and not self._bm25_results:
                yield {
                    "type": "done",
                    "answer": "未找到相关文档信息",
                    "sources": [],
                }
                return

            if getattr(self.retriever, "low_confidence", False):
                logger.info(
                    "OOD query rejected (low confidence, stream): %s", query[:60]
                )
                yield {
                    "type": "done",
                    "answer": self._REJECTION_TEMPLATE.format(question=query),
                    "sources": [],
                }
                return

            self._fused_results = rrf_fuse(
                chunks,
                self._bm25_results,
                k=self._rrf_k,
                top_k=len(chunks) + len(self._bm25_results),
            )
            logger.debug(
                "RRF fusion: %d dense + %d BM25 → %d fused results (stream)",
                len(chunks), len(self._bm25_results), len(self._fused_results),
            )
            chunks = self._materialize_fusion(chunks, self._fused_results)[
                : self._final_top_k
            ]

        # 3d. Optional cross-encoder rerank (off by default — see __init__)
        if self._reranker_enabled and chunks:
            logger.debug(
                "Reranking %d chunks for query (stream): %s",
                len(chunks), query[:60],
            )
            chunks = self._rerank_chunks(query, chunks)

        # 4. Emit sources for frontend display
        yield {"type": "sources", "data": prompts.format_sources(chunks)}

        # 5. Build prompt (+ optional history for multi-turn context)
        system_prompt, user_prompt = prompts.build_prompt(query, chunks, history)

        # 6. Stream tokens from the LLM
        answer_parts: list[str] = []
        for token in self.generator.generate_stream(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
        ):
            answer_parts.append(token)
            yield {"type": "token", "content": token}

        # 7. Signal completion with full answer + sources
        full_answer = "".join(answer_parts)

        # 7b. Post-process — remove invalid [Sx] citations
        validation = validate_citations(full_answer, chunks)
        if validation["invalid_count"] > 0:
            logger.info(
                "Removed %d invalid citation(s) from streaming answer",
                validation["invalid_count"],
            )
        full_answer = validation["answer"]

        yield {
            "type": "done",
            "answer": full_answer,
            "sources": prompts.format_sources(chunks),
        }

    # ------------------------------------------------------------------
    # Indexing
    # ------------------------------------------------------------------

    def index_documents(
        self,
        docs_dir: str | None = None,
        chunk_size: int = 500,
        chunk_overlap: int = 50,
    ) -> dict[str, Any]:
        """Load, chunk, embed, and index all knowledge documents.

        This is a full indexing pipeline that replaces any existing index
        in the vector store.  When *docs_dir* is ``None`` the default
        ``knowledge_docs/`` directory (relative to the project root) is
        used.
        """
        with self._lock:
            t0 = time.time()

            # 1. Load documents from disk
            docs = loader.load_knowledge_docs(docs_dir)
            doc_count = len(docs)
            logger.info("Loaded %d document(s)", doc_count)

            if doc_count == 0:
                # 知识库目录清空时，同步清空内存与磁盘上的旧 FAISS 与 BM25 索引
                self.vector_store.index = None
                self.vector_store.vectors = None
                self.vector_store.metadata = []
                self.vector_store.save()
                self.bm25_retriever.build([], [])
                self.bm25_retriever.save(self._bm25_dir())
                elapsed = time.time() - t0
                logger.warning("No documents found to index; cleared existing indexes")
                return {
                    "docs_count": 0,
                    "chunks_count": 0,
                    "indexed_count": 0,
                    "time_seconds": round(elapsed, 2),
                    "documents": [],
                }

            # 2. Split into overlapping chunks
            chunks = chunker.chunk_docs(docs, chunk_size, chunk_overlap)
            chunk_count = len(chunks)
            logger.info("Created %d chunk(s)", chunk_count)

            # 3. Embed all chunk texts in a single batch
            texts = [c["content"] for c in chunks]
            vectors = embedding.embed_texts(texts)

            # 4. Build parallel metadata list
            metadata = self._build_chunk_metadata(chunks)

            # 5. Build / replace the FAISS index and persist
            self.vector_store.build(vectors, metadata)
            self.vector_store.save()

            # 6. Build BM25 keyword index in parallel
            chunk_ids = [m["chunk_id"] for m in metadata]
            self.bm25_retriever.build(texts, chunk_ids)
            self.bm25_retriever.save(self._bm25_dir())

            elapsed = time.time() - t0
            logger.info("Indexed %d chunks (dense + BM25) in %.2fs", chunk_count, elapsed)

            return {
                "docs_count": doc_count,
                "chunks_count": chunk_count,
                "indexed_count": chunk_count,
                "time_seconds": round(elapsed, 2),
                "documents": self._build_manifest(docs, chunks),
            }

    @staticmethod
    def _build_chunk_metadata(chunks: list[dict]) -> list[dict]:
        """构建统一格式的 chunk 元数据列表（包含 chunk_id）。"""
        return [
            {
                "content": c["content"],
                "doc_id": str(c["doc_id"]),
                "chunk_index": c["chunk_index"],
                "chunk_id": f"{c['doc_id']}_{c['chunk_index']}",
                "title": c.get("title", ""),
                "category": c.get("category", ""),
                "source_url": c.get("source_url", ""),
            }
            for c in chunks
        ]

    @staticmethod
    def _build_manifest(
        docs: list[dict], chunks: list[dict]
    ) -> list[dict[str, Any]]:
        """Summarise indexed files for the backend's ``kb_document`` mirror."""
        manifest: dict[str, dict[str, Any]] = {}
        for doc in docs:
            manifest[doc["doc_id"]] = {
                "doc_id": doc["doc_id"],
                "title": doc.get("title", ""),
                "category": doc.get("category", ""),
                "source_url": doc.get("source_url", ""),
                "file_path": doc.get("file_path", ""),
                "chunk_count": 0,
            }

        for chunk in chunks:
            entry = manifest.get(chunk["doc_id"])
            if entry is not None:
                entry["chunk_count"] += 1

        return list(manifest.values())

    def _prepare_batch_index_payload(
        self,
        documents: list[dict],
        chunk_size: int = 500,
        chunk_overlap: int = 50,
    ) -> tuple[list[dict], list[dict], list[dict], list[str]]:
        """切片并批量向量化一组文档，单篇异常记入 failed，其余正常合并批量编码。"""
        # 同一批次内同 doc_id 仅保留最后一条，避免重复入库
        deduped: dict[str, dict] = {}
        invalid_docs: list[dict] = []
        for raw_doc in documents:
            doc_id = str(raw_doc.get("doc_id") or "").strip()
            if not doc_id:
                invalid_docs.append({"doc_id": "", "error": "doc_id 不能为空"})
                continue
            deduped[doc_id] = raw_doc

        upserted: list[dict[str, Any]] = []
        failed: list[dict[str, str]] = list(invalid_docs)
        all_chunks: list[dict] = []

        for doc_id, raw_doc in deduped.items():
            content = str(raw_doc.get("content") or "")
            if not content.strip():
                failed.append({"doc_id": doc_id, "error": "文档内容为空"})
                continue

            normalized = {
                "doc_id": doc_id,
                "title": str(raw_doc.get("title") or ""),
                "content": content,
                "category": str(raw_doc.get("category") or ""),
                "source_url": str(raw_doc.get("source_url") or ""),
            }
            try:
                doc_chunks = chunker.chunk_docs([normalized], chunk_size, chunk_overlap)
                if not doc_chunks:
                    failed.append({"doc_id": doc_id, "error": "文档切片结果为空"})
                    continue
            except Exception as exc:
                failed.append({"doc_id": doc_id, "error": f"文档切片失败: {exc}"})
                continue

            all_chunks.extend(doc_chunks)
            upserted.append({"doc_id": doc_id, "chunk_count": len(doc_chunks)})

        if not all_chunks:
            return upserted, failed, [], []

        texts = [c["content"] for c in all_chunks]
        vectors = embedding.embed_texts(texts)
        metadata = self._build_chunk_metadata(all_chunks)
        chunk_ids = [m["chunk_id"] for m in metadata]
        return upserted, failed, [{"vectors": vectors, "metadata": metadata, "texts": texts}], chunk_ids

    def _collect_existing_doc_ids(self) -> set[str]:
        """返回当前 VectorStore 中去重后的全部 doc_id 集合。"""
        return {
            str(m.get("doc_id", ""))
            for m in self.vector_store.metadata
            if m.get("doc_id") is not None and str(m.get("doc_id", "")) != ""
        }

    def get_index_state(self) -> dict[str, Any]:
        """返回当前索引状态，供后端比对增量同步差异。"""
        with self._lock:
            doc_ids = sorted(self._collect_existing_doc_ids())
            chunk_count = len(self.vector_store.metadata)
            ready = bool(
                self.vector_store.index is not None
                and self.vector_store.index.ntotal > 0
            )
            return {
                "doc_ids": doc_ids,
                "doc_count": len(doc_ids),
                "chunk_count": chunk_count,
                "ready": ready,
            }

    def sync_index(
        self,
        upsert: list[dict],
        delete_doc_ids: list[str],
        chunk_size: int = 500,
        chunk_overlap: int = 50,
    ) -> dict[str, Any]:
        """增量同步：先清理待删除及待更新文档的旧 chunk，再批量切片向量化入库并落盘。"""
        with self._lock:
            delete_set = {str(d).strip() for d in delete_doc_ids if str(d).strip()}
            upsert_ids = {
                str(d.get("doc_id") or "").strip()
                for d in upsert
                if str(d.get("doc_id") or "").strip()
            }
            remove_ids = delete_set | upsert_ids

            existing_doc_ids = self._collect_existing_doc_ids()
            deleted_count = len((delete_set - upsert_ids) & existing_doc_ids)

            if remove_ids:
                # 同时从 VectorStore metadata 与 BM25 chunk_id 前缀定位需要移除的切片
                removed_chunk_ids: set[str] = set()
                for did in remove_ids:
                    removed_chunk_ids.update(self.vector_store.chunk_ids_for_doc(did))
                for cid in getattr(self.bm25_retriever, "_chunk_ids", []):
                    if "_" in cid and cid.rsplit("_", 1)[0] in remove_ids:
                        removed_chunk_ids.add(cid)

                self.vector_store.delete_docs(remove_ids)
                if removed_chunk_ids:
                    self.bm25_retriever.remove_documents(removed_chunk_ids)

            upserted, failed, packed, chunk_ids = self._prepare_batch_index_payload(
                upsert, chunk_size=chunk_size, chunk_overlap=chunk_overlap
            )
            if packed:
                payload = packed[0]
                self.vector_store.add(payload["vectors"], payload["metadata"])
                self.bm25_retriever.add_documents(payload["texts"], chunk_ids)

            self.vector_store.save()
            self.bm25_retriever.save(self._bm25_dir())

            total_docs = len(self._collect_existing_doc_ids())
            total_chunks = len(self.vector_store.metadata)
            return {
                "upserted": upserted,
                "failed": failed,
                "deleted_count": deleted_count,
                "total_docs": total_docs,
                "total_chunks": total_chunks,
            }

    def rebuild_index(
        self,
        documents: list[dict],
        chunk_size: int = 500,
        chunk_overlap: int = 50,
    ) -> dict[str, Any]:
        """基于权威文档列表全量重建 FAISS 与 BM25 索引并落盘。"""
        with self._lock:
            deleted_count = len(self._collect_existing_doc_ids())

            # 清空内存中的旧索引
            self.vector_store.index = None
            self.vector_store.vectors = None
            self.vector_store.metadata = []
            self.bm25_retriever.build([], [])

            upserted: list[dict[str, Any]] = []
            failed: list[dict[str, str]] = []
            if documents:
                upserted, failed, packed, chunk_ids = self._prepare_batch_index_payload(
                    documents, chunk_size=chunk_size, chunk_overlap=chunk_overlap
                )
                if packed:
                    payload = packed[0]
                    self.vector_store.build(payload["vectors"], payload["metadata"])
                    self.bm25_retriever.build(payload["texts"], chunk_ids)

            self.vector_store.save()
            self.bm25_retriever.save(self._bm25_dir())

            total_docs = len(self._collect_existing_doc_ids())
            total_chunks = len(self.vector_store.metadata)
            return {
                "upserted": upserted,
                "failed": failed,
                "deleted_count": deleted_count,
                "total_docs": total_docs,
                "total_chunks": total_chunks,
            }

    def add_document(
        self,
        file_path: str,
        chunk_size: int = 500,
        chunk_overlap: int = 50,
        doc_id: str | None = None,
    ) -> dict[str, Any]:
        """Add a single document to the existing vector store."""
        with self._lock:
            return self._add_document_unlocked(
                file_path=file_path,
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
                doc_id=doc_id,
            )

    def _add_document_unlocked(
        self,
        file_path: str,
        chunk_size: int = 500,
        chunk_overlap: int = 50,
        doc_id: str | None = None,
    ) -> dict[str, Any]:
        # 1. Load the single document
        doc = loader.load_file(file_path)
        doc_id = doc_id or doc["doc_id"]
        doc["doc_id"] = doc_id

        # 2. Chunk
        chunks = chunker.chunk_docs([doc], chunk_size, chunk_overlap)
        chunk_count = len(chunks)
        logger.info("Created %d chunk(s) for %s", chunk_count, file_path)

        if chunk_count == 0:
            return {
                "chunks_count": 0,
                "indexed": 0,
                "doc_id": doc_id,
                "bm25_chunks": self.bm25_retriever.count,
                "title": doc.get("title", ""),
                "category": doc.get("category", ""),
                "source_url": doc.get("source_url", ""),
                "file_path": doc.get("file_path", ""),
            }

        # 3. Embed
        texts = [c["content"] for c in chunks]
        vectors = embedding.embed_texts(texts)

        # 4. Metadata
        metadata = self._build_chunk_metadata(chunks)

        # 5. Incrementally add to the existing index and persist
        self.vector_store.add(vectors, metadata)
        self.vector_store.save()

        # 5b. Keep the sparse index in sync
        chunk_ids = [m["chunk_id"] for m in metadata]
        self.bm25_retriever.add_documents(texts, chunk_ids)
        self.bm25_retriever.save(self._bm25_dir())

        logger.info(
            "Added %d chunk(s) (doc_id=%s, bm25 chunks=%d)",
            chunk_count,
            doc_id,
            self.bm25_retriever.count,
        )
        return {
            "chunks_count": chunk_count,
            "indexed": chunk_count,
            "doc_id": doc_id,
            "bm25_chunks": self.bm25_retriever.count,
            "title": doc.get("title", ""),
            "category": doc.get("category", ""),
            "source_url": doc.get("source_url", ""),
            "file_path": doc.get("file_path", ""),
        }

    def import_document(
        self,
        source_path: str,
        category: str | None = None,
        chunk_size: int = 500,
        chunk_overlap: int = 50,
    ) -> dict[str, Any]:
        """Normalise an uploaded file into the knowledge directory and index it."""
        with self._lock:
            parsed = loader.load_file(source_path)
            persisted_path = loader.write_content_doc(parsed, category=category)
            result = self._add_document_unlocked(
                persisted_path,
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
            )
            result["persisted_path"] = persisted_path
            logger.info(
                "Imported %s -> %s (doc_id=%s, %d chunk(s))",
                source_path,
                persisted_path,
                result["doc_id"],
                result["chunks_count"],
            )
            return result

    # ------------------------------------------------------------------
    # Remove document
    # ------------------------------------------------------------------

    def remove_document(self, doc_id: str, delete_file: bool = True) -> dict[str, Any]:
        """Remove a document from the index and (optionally) from disk."""
        with self._lock:
            removed_chunk_ids = self.vector_store.chunk_ids_for_doc(doc_id)
            source_file = self._content_file_for_doc(doc_id)

            vectors_deleted = self.vector_store.delete(doc_id)
            self.vector_store.save()

            bm25_deleted = self.bm25_retriever.remove_documents(removed_chunk_ids)
            if bm25_deleted or self.bm25_retriever.count == 0:
                self.bm25_retriever.save(self._bm25_dir())

            file_deleted = False
            if delete_file and source_file:
                try:
                    os.unlink(source_file)
                    file_deleted = True
                    logger.info("Deleted knowledge file %s", source_file)
                except OSError as exc:  # pragma: no cover - 极少数权限/占用情况
                    logger.warning("Could not delete %s: %s", source_file, exc)

            logger.info(
                "Removed document %s (vectors=%d, bm25=%d, file=%s)",
                doc_id,
                vectors_deleted,
                bm25_deleted,
                file_deleted,
            )
            return {
                "vectors_deleted": vectors_deleted,
                "bm25_deleted": bm25_deleted,
                "file_deleted": file_deleted,
            }

    def _content_file_for_doc(self, doc_id: str) -> str | None:
        """Find the knowledge-directory file that produced *doc_id*."""
        try:
            candidates = loader.load_knowledge_docs()
        except FileNotFoundError:
            return None

        for doc in candidates:
            if str(doc.get("doc_id", "")) == str(doc_id):
                return doc.get("file_path")
        return None

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------

    def get_stats(self) -> dict[str, Any]:
        """Return combined pipeline and vector store statistics."""
        with self._lock:
            store_stats = self.vector_store.get_stats()
            return {
                "pipeline": {
                    "retriever_ready": self.vector_store.index is not None,
                    "dense_ready": self.vector_store.index is not None,
                    "bm25_ready": self.bm25_retriever.count > 0,
                    "bm25_chunks": self.bm25_retriever.count,
                    "candidate_depth": self._candidate_depth,
                    "final_top_k": self._final_top_k,
                    "rrf_k": self._rrf_k,
                    "reranker_enabled": self._reranker_enabled,
                    "default_top_k": self._candidate_depth,
                    "default_min_score": 0.0,
                },
                "vector_store": store_stats,
            }
