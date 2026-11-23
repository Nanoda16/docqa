import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageOutlined,
  FolderOutlined,
  ControlOutlined,
  UserOutlined,
  ArrowRightOutlined,
  CloudUploadOutlined,
  DashboardOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { getRoleLabel, type DocumentSyncStatus } from '../types';

interface SubLink {
  label: string;
  path: string;
  icon?: React.ReactNode;
}

interface DomainEntry {
  key: string;
  title: string;
  desc: string;
  path: string;
  icon: React.ReactNode;
  meta?: string;
  subLinks?: SubLink[];
}

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [syncStatus, setSyncStatus] = useState<DocumentSyncStatus | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get('/document/sync-status', { silentError: true })
      .then((res: any) => {
        if (active && res?.code === 200 && res?.data) {
          setSyncStatus(res.data as DocumentSyncStatus);
        }
      })
      .catch(() => {
        // 静默忽略，不编造任何兜底数字
      });
    return () => {
      active = false;
    };
  }, []);

  const displayName = user?.nickname || user?.username || '用户';
  const roleLabel = getRoleLabel(user?.role);

  const knowledgeMeta = syncStatus
    ? `${syncStatus.total_docs} 篇文档 · ${syncStatus.indexed_chunks} 个索引块`
    : undefined;

  const entries: DomainEntry[] = [
    {
      key: 'chat',
      title: '智能问答',
      desc: '向企业知识库提问，获取带原文引用溯源的流式回答。',
      path: '/chat',
      icon: <MessageOutlined />,
      meta: syncStatus
        ? syncStatus.ai_service_online
          ? '检索服务在线'
          : '检索服务离线'
        : undefined,
    },
    {
      key: 'knowledge',
      title: '知识库',
      desc: '按分类检索与维护文档，上传新文件并同步向量索引。',
      path: '/knowledge/list',
      icon: <FolderOutlined />,
      meta: knowledgeMeta,
      subLinks: [
        { label: '文档列表', path: '/knowledge/list' },
        { label: '上传与索引', path: '/knowledge/upload', icon: <CloudUploadOutlined /> },
      ],
    },
  ];

  if (isAdmin) {
    entries.push({
      key: 'console',
      title: '系统控制台',
      desc: '集中查看缓存运行状态，管理成员账号与角色权限。',
      path: '/console',
      icon: <ControlOutlined />,
      subLinks: [
        { label: '缓存监控', path: '/console/cache', icon: <DashboardOutlined /> },
        { label: '人员管理', path: '/console/users', icon: <TeamOutlined /> },
      ],
    });
  }

  entries.push({
    key: 'profile',
    title: '个人中心',
    desc: '更新昵称、邮箱等个人资料，修改登录密码。',
    path: '/account/profile',
    icon: <UserOutlined />,
    meta: user?.email || user?.username || undefined,
  });

  return (
    <div className="space-y-8 sm:space-y-10">
      {/* 顶部身份概览与主入口 */}
      <section
        className="pb-7 flex flex-col sm:flex-row sm:items-end justify-between gap-5"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="space-y-2.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-medium"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--ink-2)',
              }}
            >
              {roleLabel}
            </span>
            {syncStatus && (
              <span
                className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11.5px] font-medium"
                style={{
                  background: syncStatus.ai_service_online
                    ? 'var(--status-ok-bg)'
                    : 'var(--status-warn-bg)',
                  color: syncStatus.ai_service_online
                    ? 'var(--status-ok)'
                    : 'var(--status-warn)',
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background: syncStatus.ai_service_online
                      ? 'var(--status-ok)'
                      : 'var(--status-warn)',
                  }}
                />
                {syncStatus.ai_service_online ? 'AI 服务已连接' : 'AI 服务未连接'}
              </span>
            )}
          </div>

          <h1
            className="text-[28px] sm:text-[34px] font-semibold leading-tight tracking-[-0.04em] truncate"
            style={{ color: 'var(--ink)' }}
          >
            你好，{displayName}
          </h1>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => navigate('/chat')}
            className="apple-btn-primary inline-flex items-center gap-2 h-10 px-5 text-[13.5px] cursor-pointer"
          >
            <span>开始问答</span>
            <ArrowRightOutlined style={{ fontSize: 12 }} />
          </button>
          <button
            type="button"
            onClick={() => navigate('/knowledge/upload')}
            className="apple-btn-secondary inline-flex items-center gap-2 h-10 px-4 text-[13.5px] cursor-pointer"
          >
            <CloudUploadOutlined style={{ fontSize: 13 }} />
            <span>上传文档</span>
          </button>
        </div>
      </section>

      {/* 核心功能域入口网格 */}
      <section aria-label="功能域入口">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
          {entries.map((entry) => (
            <div
              key={entry.key}
              className="apple-card-interactive p-6 flex flex-col justify-between gap-6"
            >
              <button
                type="button"
                onClick={() => navigate(entry.path)}
                className="text-left bg-transparent border-0 p-0 cursor-pointer group w-full"
              >
                <div className="flex items-start justify-between gap-4">
                  <span
                    className="grid place-items-center w-10 h-10 rounded-[12px] text-[17px] shrink-0"
                    style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      color: 'var(--ink)',
                    }}
                  >
                    {entry.icon}
                  </span>
                  <ArrowRightOutlined
                    className="mt-1 transition-transform duration-200 group-hover:translate-x-0.5"
                    style={{ color: 'var(--ink-3)', fontSize: 13 }}
                  />
                </div>

                <h2
                  className="mt-5 text-[18px] font-semibold tracking-[-0.02em]"
                  style={{ color: 'var(--ink)' }}
                >
                  {entry.title}
                </h2>
                <p
                  className="mt-1.5 mb-0 text-[13.5px] leading-relaxed"
                  style={{ color: 'var(--ink-2)' }}
                >
                  {entry.desc}
                </p>
              </button>

              {(entry.meta || (entry.subLinks && entry.subLinks.length > 0)) && (
                <div
                  className="pt-4 flex items-center justify-between gap-3 flex-wrap"
                  style={{ borderTop: '1px solid var(--border)' }}
                >
                  {entry.meta ? (
                    <span
                      className="num text-[12px] truncate"
                      style={{ color: 'var(--ink-3)' }}
                    >
                      {entry.meta}
                    </span>
                  ) : (
                    <span />
                  )}

                  {entry.subLinks && entry.subLinks.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {entry.subLinks.map((sub) => (
                        <button
                          key={sub.path}
                          type="button"
                          onClick={() => navigate(sub.path)}
                          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-medium transition-colors cursor-pointer"
                          style={{
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            color: 'var(--ink)',
                          }}
                        >
                          {sub.icon && <span className="text-[11px]">{sub.icon}</span>}
                          <span>{sub.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 底部极简键盘提示 */}
      <footer
        className="pt-2 flex items-center justify-between text-[12px] flex-wrap gap-2"
        style={{ color: 'var(--ink-3)' }}
      >
        <span className="flex items-center gap-1.5">
          <span>任意页面按</span>
          <kbd className="kbd-chip">⌘K</kbd>
          <span>或</span>
          <kbd className="kbd-chip">Ctrl K</kbd>
          <span>跨层级快速跳转</span>
        </span>
        <span className="num">DocQA Workspace</span>
      </footer>
    </div>
  );
}
