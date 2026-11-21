import { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Input, Button, message, Tooltip, Drawer, Popconfirm } from 'antd';
import {
  SendOutlined,
  PlusOutlined,
  DeleteOutlined,
  LikeOutlined,
  DislikeOutlined,
  StopOutlined,
  DownOutlined,
  PaperClipOutlined,
  BulbOutlined,
  CopyOutlined,
  CheckOutlined,
  DatabaseOutlined,
  ArrowRightOutlined,
  HistoryOutlined,
  RobotOutlined,
  UserOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import api from '../services/api';
import SourceCards from '../components/SourceCards';
import MarkdownRenderer from '../components/MarkdownRenderer';
import { streamChat, type SourceItem } from '../lib/sse';
import type { DocumentSyncStatus } from '../types';

interface Message {
  id: number;
  role: 'user' | 'ai';
  content: string;
  questionText?: string;
  recordId?: number;
  fromCache?: boolean;
  sources?: any[];
  feedback?: number;
}

interface Session {
  session_id: string;
  question_count: number;
  last_question: string;
  last_answer: string;
  updated_at: string;
}

const DEFAULT_SUGGESTIONS = [
  '企业知识库里有哪些核心流程或操作规范？',
  '如何上传新文档并同步到检索索引？',
  '请帮我总结相关制度文档的重点内容。',
];

export default function Chat() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<string>('');
  const [hotQuestions, setHotQuestions] = useState<{ question: string; count: number }[]>([]);
  const [syncStatus, setSyncStatus] = useState<DocumentSyncStatus | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<number>>(new Set());
  const [highlightedSource, setHighlightedSource] = useState<{
    msgId: number;
    index: number;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generateSessionId = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `session-${crypto.randomUUID()}`
      : `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const loadSessions = useCallback(async () => {
    try {
      const res: any = await api.get('/qa/history', { silentError: true });
      if (res?.code === 200) {
        setSessions(res.data?.items || []);
      }
    } catch {
      /* 忽略 */
    }
  }, []);

  const loadHotQuestions = useCallback(async () => {
    try {
      const res: any = await api.get('/qa/hot?limit=5', { silentError: true });
      if (res?.code === 200) {
        setHotQuestions(res.data?.questions || []);
      }
    } catch {
      /* 忽略 */
    }
  }, []);

  const loadSyncStatus = useCallback(async () => {
    try {
      const res: any = await api.get('/document/sync-status', { silentError: true });
      if (res?.code === 200 && res?.data) {
        setSyncStatus(res.data);
      }
    } catch {
      /* 忽略 */
    }
  }, []);

  useEffect(() => {
    loadSessions();
    loadHotQuestions();
    loadSyncStatus();
  }, [loadSessions, loadHotQuestions, loadSyncStatus]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadSessionMessages = async (sessionId: string) => {
    if (loading) return;
    setCurrentSession(sessionId);
    setMessages([]);
    setExpandedSources(new Set());
    setHighlightedSource(null);
    setMobileSessionsOpen(false);
    setLoading(true);
    try {
      const res: any = await api.get(`/qa/session/${sessionId}?page_size=100`);
      if (res?.code === 200) {
        const loaded: Message[] = [];
        (res.data?.items || []).forEach((item: any) => {
          loaded.push({ id: item.id * 2, role: 'user', content: item.question });
          if (item.answer) {
            loaded.push({
              id: item.id * 2 + 1,
              role: 'ai',
              content: item.answer,
              questionText: item.question,
              recordId: item.id,
              sources: item.sources || [],
              feedback: item.feedback,
            });
          }
        });
        setMessages(loaded);
      }
    } finally {
      setLoading(false);
    }
  };

  const createNewSession = () => {
    if (loading) return;
    setCurrentSession(generateSessionId());
    setMessages([]);
    setExpandedSources(new Set());
    setHighlightedSource(null);
    setMobileSessionsOpen(false);
  };

  const buildHistory = (msgs: Message[]): { role: string; content: string }[] =>
    msgs
      .filter((m) => m.content && m.content.trim())
      .slice(-6)
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'ai', content: m.content }));

  /**
   * 发起 SSE 流式检索生成并落库
   */
  const runStreamAnswer = async (
    question: string,
    recordId: number,
    aiMsgId: number,
    priorHistory: { role: string; content: string }[],
  ) => {
    const controller = new AbortController();
    abortRef.current = controller;
    let acc = '';
    let finalSources: SourceItem[] | undefined;

    const appendToken = (content: string) => {
      acc += content;
      flushSync(() => {
        setMessages((prev) =>
          prev.map((m) => (m.id === aiMsgId ? { ...m, content: acc } : m)),
        );
      });
    };

    try {
      await streamChat(
        '/api/ai/query/stream',
        { question, top_k: 5, history: JSON.stringify(priorHistory) },
        {
          onChunk: appendToken,
          onSources: (srcs) => {
            finalSources = srcs;
            flushSync(() => {
              setMessages((prev) =>
                prev.map((m) => (m.id === aiMsgId ? { ...m, sources: srcs } : m)),
              );
            });
          },
          onDone: (result) => {
            const answer = result.answer || acc || '未获取到回答';
            const sources = finalSources ?? result.sources;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMsgId ? { ...m, content: answer, sources } : m,
              ),
            );
            api
              .post('/qa/answer', {
                record_id: recordId,
                answer,
                sources,
                tokens_used: 0,
                duration_ms: 0,
              })
              .then(() => {
                loadSessions();
                loadHotQuestions();
              })
              .catch(() => {});
          },
          onError: (err) => {
            if (controller.signal.aborted) return;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMsgId && !m.content
                  ? { ...m, content: `回答失败：${err.message}` }
                  : m,
              ),
            );
          },
        },
        { signal: controller.signal, maxRetries: 0 },
      );
    } catch {
      /* 已由 onError 或终止逻辑处理 */
    } finally {
      abortRef.current = null;
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const question = input.trim();
    setInput('');

    const sessionId = currentSession || generateSessionId();
    if (!currentSession) setCurrentSession(sessionId);

    const priorHistory = buildHistory(messages);
    setMessages((prev) => [...prev, { id: Date.now(), role: 'user', content: question }]);
    setLoading(true);

    try {
      const askRes: any = await api.post(
        `/qa/ask?question=${encodeURIComponent(question)}&session_id=${encodeURIComponent(sessionId)}`,
      );
      if (askRes?.code !== 200) return;

      if (askRes.data.from_cache) {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            role: 'ai',
            content: askRes.data.answer,
            questionText: question,
            recordId: askRes.data.id,
            sources: askRes.data.sources || [],
            fromCache: true,
          },
        ]);
        loadSessions();
        loadHotQuestions();
      } else {
        const recordId = askRes.data.id;
        const aiMsgId = Date.now() + 1;
        setMessages((prev) => [
          ...prev,
          {
            id: aiMsgId,
            role: 'ai',
            content: '',
            questionText: question,
            recordId,
          },
        ]);
        await runStreamAnswer(question, recordId, aiMsgId, priorHistory);
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * 跳过缓存，使用原问题重新发起 RAG 检索生成并原地刷新当前回答
   */
  const retryWithoutCache = async (targetMsg: Message) => {
    if (loading) return;
    const question = targetMsg.questionText?.trim();
    if (!question) {
      message.warning('无法获取原始问题，请重新输入提问');
      return;
    }

    const sessionId = currentSession || generateSessionId();
    if (!currentSession) setCurrentSession(sessionId);

    const targetIdx = messages.findIndex((m) => m.id === targetMsg.id);
    // 取该回答之前的对话轮次作为历史上下文（剔除紧邻的同题 user 提问）
    const precedingMsgs =
      targetIdx > 0 ? messages.slice(0, Math.max(0, targetIdx - 1)) : [];
    const priorHistory = buildHistory(precedingMsgs);

    setLoading(true);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === targetMsg.id
          ? {
              ...m,
              content: '',
              sources: [],
              fromCache: false,
              feedback: undefined,
            }
          : m,
      ),
    );

    try {
      const askRes: any = await api.post(
        `/qa/ask?question=${encodeURIComponent(question)}&session_id=${encodeURIComponent(sessionId)}&bypass_cache=true`,
      );
      if (askRes?.code !== 200) return;
      const newRecordId = askRes.data.id;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === targetMsg.id ? { ...m, recordId: newRecordId } : m,
        ),
      );
      await runStreamAnswer(question, newRecordId, targetMsg.id, priorHistory);
    } finally {
      setLoading(false);
    }
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  };

  const toggleSources = (messageId: number) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const handleCitationClick = (msgId: number, index: number) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      next.add(msgId);
      return next;
    });
    setHighlightedSource({ msgId, index });
  };

  const copyContent = async (msgId: number, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(msgId);
      message.success('已复制到剪贴板');
      setTimeout(() => {
        setCopiedId((prev) => (prev === msgId ? null : prev));
      }, 2000);
    } catch {
      message.error('复制失败，请手动选中复制');
    }
  };

  const submitFeedback = async (recordId: number, feedback: number) => {
    try {
      const res: any = await api.post(
        `/qa/feedback?record_id=${recordId}&feedback=${feedback}`,
      );
      if (feedback === 1) {
        message.success(res?.message || '已点赞，回答已加入问答缓存');
      } else {
        message.success(res?.message || '已记录反馈并从缓存移除');
      }
      setMessages((prev) =>
        prev.map((m) => (m.recordId === recordId ? { ...m, feedback } : m)),
      );
    } catch {
      /* 拦截器处理 */
    }
  };

  const deleteSession = async (sessionId: string) => {
    try {
      await api.delete(`/qa/session/${sessionId}`);
      message.success('会话已删除');
      loadSessions();
      if (sessionId === currentSession) {
        setCurrentSession('');
        setMessages([]);
      }
    } catch {
      /* 拦截器处理 */
    }
  };

  const suggestions = hotQuestions.length
    ? hotQuestions.slice(0, 3).map((q) => q.question)
    : DEFAULT_SUGGESTIONS;

  const pendingChanges =
    (syncStatus?.pending_upsert ?? 0) + (syncStatus?.pending_delete ?? 0);

  const sessionSidebar = (
    <div className="flex flex-col h-full">
      <div className="p-3.5 border-b border-white/10">
        <Button
          className="btn-glass"
          icon={<PlusOutlined />}
          block
          onClick={createNewSession}
          disabled={loading}
        >
          新建对话
        </Button>
      </div>

      <div className="px-4 pt-3.5 pb-1.5 flex items-center justify-between text-[12px] text-moon-light font-medium">
        <span>历史会话</span>
        <span className="num">{sessions.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-2">
        {sessions.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-[12.5px] text-moon-light leading-relaxed">
              暂无历史会话，发起提问后将自动保存记录。
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {sessions.map((s) => {
              const active = s.session_id === currentSession;
              return (
                <li key={s.session_id}>
                  <div
                    data-active={active}
                    className="session-row group flex items-start gap-2 px-3 py-2.5 cursor-pointer"
                    onClick={() => loadSessionMessages(s.session_id)}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-[13px] truncate leading-snug ${
                          active ? 'text-white font-medium' : 'text-white/80'
                        }`}
                      >
                        {s.last_question || '新对话'}
                      </div>
                      <div className="num mt-1 text-[11px] text-moon-light truncate">
                        {s.question_count} 轮对话
                        {(() => {
                          const d = new Date(s.updated_at);
                          return isNaN(d.getTime())
                            ? ''
                            : ' · ' +
                                d.toLocaleDateString(undefined, {
                                  month: '2-digit',
                                  day: '2-digit',
                                });
                        })()}
                      </div>
                    </div>
                    <Popconfirm
                      title="确认删除该会话记录？"
                      onConfirm={(e) => {
                        e?.stopPropagation();
                        deleteSession(s.session_id);
                      }}
                      onCancel={(e) => e?.stopPropagation()}
                      okText="删除"
                      okType="danger"
                      cancelText="取消"
                    >
                      <button
                        type="button"
                        aria-label="删除会话"
                        onClick={(e) => e.stopPropagation()}
                        className="grid place-items-center w-6 h-6 shrink-0 rounded text-moon-light opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-white/10 focus-visible:opacity-100 transition-opacity"
                      >
                        <DeleteOutlined className="text-[11px]" />
                      </button>
                    </Popconfirm>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-white/10 px-3.5 py-3.5">
        <div className="flex items-center gap-1.5 pb-2 text-[12px] font-medium text-moon-light">
          <BulbOutlined className="text-champagne" />
          <span>高频提问</span>
        </div>
        {hotQuestions.length === 0 ? (
          <p className="text-[12px] text-moon-light/70">暂无热门提问</p>
        ) : (
          <ul className="space-y-1.5">
            {hotQuestions.map((q, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    setInput(q.question);
                    setMobileSessionsOpen(false);
                  }}
                  className="w-full text-left flex items-baseline gap-2 text-[12px] text-white/80 hover:text-champagne transition-colors"
                >
                  <span className="num text-[11px] text-champagne shrink-0 w-3.5">{i + 1}.</span>
                  <span className="truncate">{q.question}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[264px_minmax(0,1fr)] gap-5 h-[calc(100dvh-124px)] min-h-[540px] min-w-0">
      {/* 玻璃面板 1：桌面端会话侧栏 */}
      <aside className="hidden lg:flex flex-col min-w-0 glass-panel overflow-hidden">
        {sessionSidebar}
      </aside>

      {/* 移动端会话抽屉 */}
      <Drawer
        title={<span className="text-white">历史会话</span>}
        placement="left"
        open={mobileSessionsOpen}
        onClose={() => setMobileSessionsOpen(false)}
        width={280}
        styles={{ body: { padding: 0 } }}
      >
        {sessionSidebar}
      </Drawer>

      {/* 玻璃面板 2：右侧对话主区 */}
      <section className="glass-panel flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* 顶部紧凑知识库状态条 */}
        <div className="shrink-0 px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-white/[0.03]">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSessionsOpen(true)}
              className="lg:hidden inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[12px] border border-white/15 bg-white/[0.06] text-[12px] text-white hover:border-white/30"
            >
              <HistoryOutlined />
              会话
            </button>

            <div className="flex items-center gap-2 text-[12.5px] text-moon-light min-w-0">
              <DatabaseOutlined className="text-champagne shrink-0" />
              {syncStatus ? (
                <span className="truncate">
                  知识库已就绪：已同步{' '}
                  <strong className="num text-white">{syncStatus.synced_docs}</strong> 篇文档 /{' '}
                  <strong className="num text-white">{syncStatus.indexed_chunks}</strong> 个片段
                </span>
              ) : (
                <span>正在获取知识库状态…</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {syncStatus && syncStatus.synced_docs === 0 && (
              <button
                type="button"
                onClick={() => navigate('/documents')}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11.5px] font-medium bg-warn/15 text-warn border border-warn/35 hover:bg-warn/25 transition-colors"
              >
                暂无已同步文档，前往知识库
                <ArrowRightOutlined className="text-[10px]" />
              </button>
            )}
            {syncStatus && syncStatus.synced_docs > 0 && pendingChanges > 0 && (
              <button
                type="button"
                onClick={() => navigate('/documents')}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11.5px] font-medium bg-champagne/15 text-champagne border border-champagne/40 hover:bg-champagne/25 transition-colors"
              >
                有 {pendingChanges} 项变更待同步
                <ArrowRightOutlined className="text-[10px]" />
              </button>
            )}
          </div>
        </div>

        {/* 消息流 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-5">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-2">
              <span className="grid place-items-center w-14 h-14 rounded-[18px] bg-white/[0.06] text-champagne border border-champagne/35 text-[24px]">
                <RobotOutlined />
              </span>
              <h2 className="mt-5 text-[20px] font-semibold text-white">有什么可以帮您？</h2>
              <p className="mt-2 text-[13.5px] text-moon-light max-w-[440px] leading-relaxed">
                在下方输入问题，我将检索已同步的企业文档为您提供精准解答并附上参考出处。点赞满意的回答可加入优质问答缓存。
              </p>

              <div className="mt-7 w-full max-w-[540px] space-y-2.5">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setInput(s)}
                    className="w-full text-left px-4 py-3 rounded-[16px] border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.09] hover:border-white/[0.25] transition-all duration-300 text-[13px] text-white/85 hover:text-white flex items-center gap-3"
                  >
                    <span className="num text-[11.5px] font-medium text-champagne shrink-0">
                      0{i + 1}
                    </span>
                    <span className="truncate">{s}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6 max-w-[900px] mx-auto">
              {messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex justify-end gap-2.5">
                    <div className="max-w-[80%] md:max-w-[72%] rounded-[20px] rounded-tr-[6px] bg-white/[0.12] border border-white/[0.2] text-white px-4 py-3 text-[13.5px] leading-[1.7] whitespace-pre-wrap break-words shadow-sm">
                      {m.content}
                    </div>
                    <span className="grid place-items-center w-8 h-8 rounded-full bg-white/[0.08] border border-white/15 text-moon-light text-[13px] shrink-0 mt-0.5">
                      <UserOutlined />
                    </span>
                  </div>
                ) : (
                  <div key={m.id} className="flex justify-start gap-2.5">
                    <span className="grid place-items-center w-8 h-8 rounded-full bg-champagne/15 border border-champagne/40 text-champagne text-[14px] shrink-0 mt-0.5">
                      <RobotOutlined />
                    </span>

                    <div className="max-w-[88%] md:max-w-[82%] min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1.5 text-[11.5px] text-moon-light">
                        <span className="font-medium text-white/90">知识库助手</span>
                        {m.fromCache && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ok/15 border border-ok/35 text-[10.5px] text-ok">
                            <ThunderboltOutlined className="text-[10px]" />
                            已命中优质缓存
                          </span>
                        )}
                      </div>

                      <div className="rounded-[20px] rounded-tl-[6px] bg-white/[0.05] border border-white/[0.12] px-4 py-3.5">
                        {m.content ? (
                          <MarkdownRenderer
                            content={m.content}
                            onCitationClick={(idx) => handleCitationClick(m.id, idx)}
                          />
                        ) : (
                          <span className="inline-flex items-center gap-2 text-moon-light text-[13px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-champagne animate-pulse" />
                            <span>正在检索知识库并生成回答…</span>
                          </span>
                        )}
                      </div>

                      {m.content && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-moon-light">
                          <Tooltip title={copiedId === m.id ? '已复制' : '复制回答'}>
                            <button
                              type="button"
                              aria-label="复制回答"
                              onClick={() => copyContent(m.id, m.content)}
                              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] hover:bg-white/10 hover:text-white transition-colors"
                            >
                              {copiedId === m.id ? (
                                <CheckOutlined className="text-ok text-[12px]" />
                              ) : (
                                <CopyOutlined className="text-[12px]" />
                              )}
                              <span>{copiedId === m.id ? '已复制' : '复制'}</span>
                            </button>
                          </Tooltip>

                          {m.recordId && (
                            <>
                              <Tooltip title="点赞并加入问答缓存">
                                <button
                                  type="button"
                                  aria-label="点赞并加入问答缓存"
                                  onClick={() => submitFeedback(m.recordId!, 1)}
                                  className={`grid place-items-center w-7 h-7 rounded-full hover:bg-white/10 transition-colors ${
                                    m.feedback === 1
                                      ? 'text-champagne bg-champagne/15 border border-champagne/35'
                                      : ''
                                  }`}
                                >
                                  <LikeOutlined className="text-[12px]" />
                                </button>
                              </Tooltip>
                              <Tooltip title="点踩并移除此条问答缓存">
                                <button
                                  type="button"
                                  aria-label="点踩并移除此条问答缓存"
                                  onClick={() => submitFeedback(m.recordId!, 2)}
                                  className={`grid place-items-center w-7 h-7 rounded-full hover:bg-white/10 transition-colors ${
                                    m.feedback === 2
                                      ? 'text-danger bg-danger/15 border border-danger/35'
                                      : ''
                                  }`}
                                >
                                  <DislikeOutlined className="text-[12px]" />
                                </button>
                              </Tooltip>
                            </>
                          )}

                          {m.fromCache && m.questionText && (
                            <Tooltip title="跳过缓存重新检索知识库并生成回答">
                              <button
                                type="button"
                                disabled={loading}
                                onClick={() => retryWithoutCache(m)}
                                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] text-moon-light hover:bg-white/10 hover:text-champagne disabled:opacity-40 transition-colors"
                              >
                                <ReloadOutlined className="text-[11px]" />
                                <span>重新检索</span>
                              </button>
                            </Tooltip>
                          )}

                          {m.sources && m.sources.length > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleSources(m.id)}
                              aria-expanded={expandedSources.has(m.id)}
                              className="ml-1 inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[12px] text-white/85 bg-white/[0.05] border border-white/12 hover:border-champagne/40 hover:text-champagne transition-colors"
                            >
                              <PaperClipOutlined className="text-[11px]" />
                              <span>参考来源</span>
                              <span className="num text-[11px] font-semibold text-champagne">
                                {m.sources.length}
                              </span>
                              <DownOutlined
                                className={`text-[10px] transition-transform duration-200 ${
                                  expandedSources.has(m.id) ? 'rotate-180' : ''
                                }`}
                              />
                            </button>
                          )}
                        </div>
                      )}

                      {m.sources && m.sources.length > 0 && expandedSources.has(m.id) && (
                        <SourceCards
                          sources={m.sources}
                          highlightedIndex={
                            highlightedSource?.msgId === m.id ? highlightedSource.index : null
                          }
                        />
                      )}
                    </div>
                  </div>
                ),
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 底部输入区 */}
        <div className="shrink-0 border-t border-white/10 p-3.5 md:p-4 bg-white/[0.03]">
          <div className="max-w-[900px] mx-auto rounded-[18px] border border-white/[0.15] bg-white/[0.04] focus-within:border-white/40 focus-within:shadow-[0_0_0_3px_rgba(255,255,255,0.08)] transition-all duration-500 ease-liquid">
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入您想咨询的问题，基于企业知识库实时检索解答…"
              autoSize={{ minRows: 1, maxRows: 5 }}
              variant="borderless"
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              className="!px-4 !py-3 !text-[14px]"
            />
            <div className="flex items-center justify-between px-3.5 pb-3 pt-1">
              <span className="text-[11.5px] text-moon-light/75">
                Enter 发送 · Shift + Enter 换行
              </span>

              {loading ? (
                <Button
                  danger
                  size="small"
                  icon={<StopOutlined />}
                  onClick={stopGeneration}
                  className="!rounded-full !px-3.5"
                >
                  停止生成
                </Button>
              ) : (
                <Button
                  icon={<SendOutlined />}
                  onClick={sendMessage}
                  disabled={!input.trim()}
                  className="btn-champagne !px-5 !h-8"
                >
                  发送
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
