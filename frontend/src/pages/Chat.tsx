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
  CopyOutlined,
  CheckOutlined,
  ArrowRightOutlined,
  HistoryOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
    <div className="flex flex-col h-full bg-[var(--surface-2)]">
      <div className="p-3 border-b border-[var(--border)]">
        <Button
          className="apple-btn-primary !h-9"
          icon={<PlusOutlined />}
          block
          onClick={createNewSession}
          disabled={loading}
        >
          新建对话
        </Button>
      </div>

      <div className="px-3.5 pt-3 pb-1.5 flex items-center justify-between text-[11.5px] text-[var(--ink-3)] font-medium">
        <span>历史会话</span>
        <span className="num">{sessions.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-[12.5px] text-[var(--ink-3)] leading-relaxed m-0">
              暂无历史会话
            </p>
          </div>
        ) : (
          <ul className="space-y-0.5 m-0 p-0 list-none">
            {sessions.map((s) => {
              const active = s.session_id === currentSession;
              return (
                <li key={s.session_id}>
                  <div
                    role="button"
                    tabIndex={0}
                    data-active={active}
                    onClick={() => loadSessionMessages(s.session_id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        loadSessionMessages(s.session_id);
                      }
                    }}
                    className={`group flex items-start gap-2 px-2.5 py-2 rounded-[var(--radius-sm)] cursor-pointer transition-colors ${
                      active
                        ? 'bg-[var(--surface)] text-[var(--ink)]'
                        : 'text-[var(--ink-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-[13px] truncate leading-snug ${
                          active ? 'font-medium text-[var(--ink)]' : ''
                        }`}
                      >
                        {s.last_question || '新对话'}
                      </div>
                      <div className="num mt-0.5 text-[11px] text-[var(--ink-3)] truncate">
                        {s.question_count} 轮
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
                        className="grid place-items-center w-6 h-6 shrink-0 rounded-[6px] text-[var(--ink-3)] opacity-0 group-hover:opacity-100 hover:text-[var(--status-danger)] hover:bg-[var(--status-danger-bg)] focus-visible:opacity-100 transition-opacity"
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

      {hotQuestions.length > 0 && (
        <div className="border-t border-[var(--border)] px-3.5 py-3">
          <div className="pb-2 text-[11.5px] font-medium text-[var(--ink-3)]">高频提问</div>
          <ul className="space-y-1.5 m-0 p-0 list-none">
            {hotQuestions.map((q, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    setInput(q.question);
                    setMobileSessionsOpen(false);
                  }}
                  className="w-full text-left flex items-baseline gap-2 text-[12px] text-[var(--ink-2)] hover:text-[var(--ink)] transition-colors"
                >
                  <span className="num text-[11px] text-[var(--ink-3)] shrink-0 w-3.5">
                    {i + 1}.
                  </span>
                  <span className="truncate">{q.question}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`grid grid-cols-1 gap-4 h-[calc(100dvh-116px)] min-h-[520px] min-w-0 ${
        sidebarOpen ? 'lg:grid-cols-[260px_minmax(0,1fr)]' : 'lg:grid-cols-1'
      }`}
    >
      {/* 桌面端可折叠会话侧栏 */}
      {sidebarOpen && (
        <aside className="hidden lg:flex flex-col min-w-0 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-2)] overflow-hidden">
          {sessionSidebar}
        </aside>
      )}

      {/* 窄屏会话抽屉 */}
      <Drawer
        title={<span className="text-[var(--ink)] font-medium">历史会话</span>}
        placement="left"
        open={mobileSessionsOpen}
        onClose={() => setMobileSessionsOpen(false)}
        width={280}
        styles={{ body: { padding: 0 } }}
      >
        {sessionSidebar}
      </Drawer>

      {/* 主对话工作区 */}
      <section className="flex flex-col min-w-0 min-h-0 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-2)] overflow-hidden">
        {/* 顶部精简状态栏 */}
        <div className="shrink-0 px-4 h-12 flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)]">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* 桌面端侧栏折叠切换 */}
            <Tooltip title={sidebarOpen ? '收起会话栏' : '展开会话栏'}>
              <button
                type="button"
                aria-label={sidebarOpen ? '收起会话栏' : '展开会话栏'}
                onClick={() => setSidebarOpen((v) => !v)}
                className="hidden lg:grid place-items-center w-7 h-7 rounded-[8px] border border-[var(--border)] text-[var(--ink-2)] hover:text-[var(--ink)] hover:bg-[var(--surface)] transition-colors shrink-0"
              >
                {sidebarOpen ? (
                  <MenuFoldOutlined className="text-[13px]" />
                ) : (
                  <MenuUnfoldOutlined className="text-[13px]" />
                )}
              </button>
            </Tooltip>

            {/* 窄屏打开抽屉 */}
            <button
              type="button"
              onClick={() => setMobileSessionsOpen(true)}
              className="lg:hidden inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-[var(--border)] bg-[var(--surface)] text-[12px] font-medium text-[var(--ink)] hover:border-[var(--border-strong)] shrink-0"
            >
              <HistoryOutlined className="text-[12px]" />
              <span>会话</span>
            </button>

            <div className="text-[12.5px] text-[var(--ink-2)] truncate">
              {syncStatus ? (
                <>
                  已同步{' '}
                  <strong className="num font-semibold text-[var(--ink)]">
                    {syncStatus.synced_docs}
                  </strong>{' '}
                  篇文档 ·{' '}
                  <strong className="num font-semibold text-[var(--ink)]">
                    {syncStatus.indexed_chunks}
                  </strong>{' '}
                  个片段
                </>
              ) : (
                <span>正在获取知识库状态…</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {syncStatus && syncStatus.synced_docs === 0 ? (
              <button
                type="button"
                onClick={() => navigate('/knowledge/list')}
                className="inline-flex items-center gap-1 h-7 px-3 rounded-full text-[11.5px] font-medium bg-[var(--status-warn-bg)] text-[var(--status-warn)] border border-[var(--border)] hover:opacity-85 transition-opacity"
              >
                <span>去上传文档</span>
                <ArrowRightOutlined className="text-[10px]" />
              </button>
            ) : syncStatus && pendingChanges > 0 ? (
              <button
                type="button"
                onClick={() => navigate('/knowledge/list')}
                className="inline-flex items-center gap-1 h-7 px-3 rounded-full text-[11.5px] font-medium bg-[var(--surface)] text-[var(--ink)] border border-[var(--border-strong)] hover:bg-[var(--surface-hover)] transition-colors"
              >
                <span className="num">{pendingChanges} 项待同步</span>
                <ArrowRightOutlined className="text-[10px]" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate('/knowledge/list')}
                className="hidden sm:inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] text-[var(--ink-2)] hover:text-[var(--ink)] hover:bg-[var(--surface)] transition-colors"
              >
                <span>知识库</span>
                <ArrowRightOutlined className="text-[10px]" />
              </button>
            )}
          </div>
        </div>

        {/* 主消息流 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-6">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-2">
              <h2 className="text-[22px] sm:text-[26px] font-semibold tracking-[-0.03em] text-[var(--ink)]">
                基于知识库提问
              </h2>
              <p className="mt-2 text-[13.5px] text-[var(--ink-2)] max-w-[420px] leading-relaxed">
                每条回答均附带原文引用角标，点击可核对参考片段。
              </p>

              <div className="mt-7 w-full max-w-[540px] divide-y divide-[var(--border)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setInput(s)}
                    className="w-full text-left px-4 py-3 hover:bg-[var(--surface-hover)] transition-colors text-[13px] text-[var(--ink)] flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="num text-[11.5px] font-medium text-[var(--ink-3)] shrink-0">
                        0{i + 1}
                      </span>
                      <span className="truncate">{s}</span>
                    </div>
                    <ArrowRightOutlined className="text-[11px] text-[var(--ink-3)] shrink-0" />
                  </button>
                ))}
              </div>

              {syncStatus && syncStatus.synced_docs === 0 && (
                <button
                  type="button"
                  onClick={() => navigate('/knowledge/list')}
                  className="mt-5 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--ink-2)] hover:text-[var(--ink)] transition-colors"
                >
                  <span>当前知识库为空，前往知识库导入文档</span>
                  <ArrowRightOutlined className="text-[10px]" />
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-7 max-w-[820px] mx-auto">
              {messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] md:max-w-[74%] rounded-[18px] rounded-tr-[6px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] px-4 py-2.5 text-[14px] leading-[1.7] whitespace-pre-wrap break-words">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="min-w-0">
                    {m.fromCache && (
                      <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] text-[var(--ink-2)]">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--status-ok-bg)] text-[var(--status-ok)] text-[11px] font-medium">
                          <ThunderboltOutlined className="text-[10px]" />
                          命中缓存
                        </span>
                      </div>
                    )}

                    <div className="min-w-0 text-[var(--ink)]">
                      {m.content ? (
                        <MarkdownRenderer
                          content={m.content}
                          onCitationClick={(idx) => handleCitationClick(m.id, idx)}
                        />
                      ) : (
                        <span className="inline-flex items-center gap-2 text-[var(--ink-2)] text-[13.5px] py-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ink)] animate-pulse" />
                          <span>正在检索知识库并生成回答…</span>
                        </span>
                      )}
                    </div>

                    {m.content && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-1 text-[var(--ink-2)]">
                        <Tooltip title={copiedId === m.id ? '已复制' : '复制回答'}>
                          <button
                            type="button"
                            aria-label="复制回答"
                            onClick={() => copyContent(m.id, m.content)}
                            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] hover:bg-[var(--surface)] hover:text-[var(--ink)] transition-colors"
                          >
                            {copiedId === m.id ? (
                              <CheckOutlined className="text-[var(--status-ok)] text-[12px]" />
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
                                className={`grid place-items-center w-7 h-7 rounded-full transition-colors ${
                                  m.feedback === 1
                                    ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                                    : 'hover:bg-[var(--surface)] hover:text-[var(--ink)]'
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
                                className={`grid place-items-center w-7 h-7 rounded-full transition-colors ${
                                  m.feedback === 2
                                    ? 'bg-[var(--status-danger-bg)] text-[var(--status-danger)]'
                                    : 'hover:bg-[var(--surface)] hover:text-[var(--ink)]'
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
                              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] text-[var(--ink-2)] hover:bg-[var(--surface)] hover:text-[var(--ink)] disabled:opacity-40 transition-colors"
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
                            className="ml-1 inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[12px] text-[var(--ink)] bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border-strong)] transition-colors"
                          >
                            <PaperClipOutlined className="text-[11px] text-[var(--ink-2)]" />
                            <span>参考来源</span>
                            <span className="num text-[11px] font-semibold">
                              {m.sources.length}
                            </span>
                            <DownOutlined
                              className={`text-[10px] text-[var(--ink-3)] transition-transform duration-200 ${
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
                ),
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 底部输入区 */}
        <div className="shrink-0 border-t border-[var(--border)] p-3 sm:p-4 bg-[var(--surface-2)]">
          <div className="max-w-[820px] mx-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] focus-within:border-[var(--border-strong)] transition-colors">
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入问题，基于知识库检索并附带引用溯源…"
              autoSize={{ minRows: 1, maxRows: 5 }}
              variant="borderless"
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              className="!px-3.5 !py-2.5 !text-[14px]"
            />
            <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
              <span className="text-[11.5px] text-[var(--ink-3)]">
                Enter 发送 · Shift + Enter 换行
              </span>

              {loading ? (
                <Button
                  danger
                  size="small"
                  icon={<StopOutlined />}
                  onClick={stopGeneration}
                  className="!rounded-full !px-3.5 !h-8"
                >
                  停止生成
                </Button>
              ) : (
                <Button
                  icon={<SendOutlined />}
                  onClick={sendMessage}
                  disabled={!input.trim()}
                  className="apple-btn-primary !px-4 !h-8 !text-[13px]"
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
