import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  message,
  Table,
  Input,
  Badge,
  Popconfirm,
  Tooltip,
  Space,
  Drawer,
  Descriptions,
} from 'antd';
import type { TableProps } from 'antd';
import {
  DeleteOutlined,
  ReloadOutlined,
  FireOutlined,
  DatabaseOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  SearchOutlined,
  EyeOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons';
import api from '../services/api';

interface CacheKeyItem {
  key: string;
  type: string;
  ttl: number;
  label?: string;
  category?: 'qa' | 'session' | 'hot' | 'other' | string;
}

interface CacheKeyDetail extends CacheKeyItem {
  value: unknown;
}

const CATEGORY_META: Record<
  string,
  { label: string; colorVar: string; bgVar: string }
> = {
  qa: {
    label: '问答缓存 (qa)',
    colorVar: 'var(--ink)',
    bgVar: 'var(--surface)',
  },
  session: {
    label: '会话历史 (session)',
    colorVar: 'var(--ink-2)',
    bgVar: 'var(--surface)',
  },
  hot: {
    label: '热门统计 (hot)',
    colorVar: 'var(--status-ok)',
    bgVar: 'var(--status-ok-bg)',
  },
  other: {
    label: '其他',
    colorVar: 'var(--ink-3)',
    bgVar: 'var(--surface)',
  },
};

function inferCategory(record: CacheKeyItem): string {
  if (record.category && CATEGORY_META[record.category]) return record.category;
  if (record.key.includes(':qa:')) return 'qa';
  if (record.key.includes(':session:')) return 'session';
  if (record.key.includes(':hot:')) return 'hot';
  return 'other';
}

function formatTtl(seconds: number): string {
  if (seconds < 0) return '永不过期 / 已失效';
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m} 分 ${s} 秒`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h} 小时 ${m} 分`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d} 天 ${h} 小时`;
}

function formatPreviewValue(val: unknown): string {
  if (val === null || val === undefined) return '（空）';
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return val;
    }
  }
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

function CategoryPill({ record }: { record: CacheKeyItem }) {
  const cat = inferCategory(record);
  const meta = CATEGORY_META[cat] ?? CATEGORY_META.other;
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 text-[12px] font-medium rounded-full border border-[var(--border)] whitespace-nowrap"
      style={{
        color: meta.colorVar,
        backgroundColor: meta.bgVar,
      }}
    >
      {meta.label}
    </span>
  );
}

function MetricTile({
  label,
  value,
  icon,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="apple-surface p-5">
      <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--ink-3)]">
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-3 num text-[30px] font-semibold leading-none text-[var(--ink)]">
        {value}
      </div>
      {sub && <div className="mt-2.5 text-[12px] text-[var(--ink-2)]">{sub}</div>}
    </div>
  );
}

export default function Admin() {
  const navigate = useNavigate();

  const [stats, setStats] = useState<any>({});
  const [keys, setKeys] = useState<CacheKeyItem[]>([]);
  const [keyPattern, setKeyPattern] = useState('doc:qa:*');
  const [warmupLimit, setWarmupLimit] = useState(10);
  const [loadingKeys, setLoadingKeys] = useState(false);

  /* 勾选批量删除 */
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);

  /* 单条详情抽屉 */
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [keyDetail, setKeyDetail] = useState<CacheKeyDetail | null>(null);

  const loadCacheData = useCallback(async () => {
    setLoadingKeys(true);
    try {
      const [s, k]: any[] = await Promise.all([
        api.get('/admin/cache/stats', { silentError: true }),
        api.get(`/admin/cache/keys?pattern=${encodeURIComponent(keyPattern)}`, {
          silentError: true,
        }),
      ]);
      if (s?.code === 200) setStats(s.data || {});
      if (k?.code === 200) setKeys(k.data?.keys || []);
    } catch {
      /* 忽略轮询失败 */
    } finally {
      setLoadingKeys(false);
    }
  }, [keyPattern]);

  useEffect(() => {
    loadCacheData();
    const timer = setInterval(loadCacheData, 8000);
    return () => clearInterval(timer);
  }, [loadCacheData]);

  const clearCache = async (type: string) => {
    const paths: Record<string, string> = {
      all: '/admin/cache/clear',
      qa: '/admin/cache/clear/qa',
      sessions: '/admin/cache/clear/sessions',
      hot: '/admin/cache/clear/hot',
    };
    try {
      const r: any = await api.delete(paths[type]);
      message.success(r.message || '清理完成');
      setSelectedKeys([]);
      loadCacheData();
    } catch {
      /* 拦截器处理 */
    }
  };

  const openKeyDetail = async (key: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setKeyDetail(null);
    try {
      const res: any = await api.get(`/admin/cache/key?key=${encodeURIComponent(key)}`);
      if (res?.code === 200 && res?.data) {
        setKeyDetail(res.data);
      }
    } catch {
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDeleteSingleKey = async (key: string) => {
    try {
      await api.delete(`/admin/cache/key?key=${encodeURIComponent(key)}`);
      message.success('已删除该缓存条目');
      setSelectedKeys((prev) => prev.filter((k) => k !== key));
      if (keyDetail?.key === key) {
        setDetailOpen(false);
      }
      await loadCacheData();
    } catch {
      /* 拦截器处理 */
    }
  };

  const handleBatchDeleteKeys = async () => {
    if (selectedKeys.length === 0) return;
    setBatchDeleting(true);
    try {
      const res: any = await api.post('/admin/cache/keys/delete', {
        keys: selectedKeys,
      });
      const deletedCount = res?.data?.deleted ?? selectedKeys.length;
      message.success(`已批量删除 ${deletedCount} 条缓存`);
      setSelectedKeys([]);
      await loadCacheData();
    } catch {
      /* 拦截器处理 */
    } finally {
      setBatchDeleting(false);
    }
  };

  const serverLabel =
    stats.server_type === 'real'
      ? 'Redis 实时服务'
      : stats.server_type === 'sqlite'
        ? 'SQLite 持久化降级'
        : '本地内存降级';

  const columns: TableProps<CacheKeyItem>['columns'] = [
    {
      title: '缓存条目',
      dataIndex: 'key',
      ellipsis: { showTitle: true },
      render: (_: string, record: CacheKeyItem) => (
        <button
          type="button"
          onClick={() => openKeyDetail(record.key)}
          className="text-left w-full min-w-0 group cursor-pointer"
        >
          <div className="text-[13px] font-medium text-[var(--ink)] group-hover:underline underline-offset-2 truncate">
            {record.label || record.key}
          </div>
          <div className="num text-[11.5px] text-[var(--ink-3)] truncate">{record.key}</div>
        </button>
      ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 156,
      render: (_: string, record: CacheKeyItem) => <CategoryPill record={record} />,
    },
    {
      title: '数据类型',
      dataIndex: 'type',
      width: 100,
      render: (t: string) => (
        <span className="num inline-block px-2 py-0.5 text-[12px] rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--ink-2)]">
          {t}
        </span>
      ),
    },
    {
      title: '剩余有效期',
      dataIndex: 'ttl',
      width: 145,
      render: (t: number) => (
        <Tooltip title={t >= 0 ? `精确剩余：${t.toLocaleString()} 秒` : `原始 TTL：${t}`}>
          <span className="num text-[var(--ink)] whitespace-nowrap cursor-help">
            {formatTtl(t)}
          </span>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 145,
      fixed: 'right',
      render: (_: any, record: CacheKeyItem) => (
        <Space size={2} className="whitespace-nowrap">
          <Button
            type="link"
            size="small"
            className="!px-1.5"
            icon={<EyeOutlined />}
            onClick={() => openKeyDetail(record.key)}
          >
            查看
          </Button>
          <Popconfirm
            title="确认删除该缓存条目？"
            onConfirm={() => handleDeleteSingleKey(record.key)}
            okText="删除"
            okType="danger"
            cancelText="取消"
          >
            <Button type="link" danger size="small" className="!px-1.5" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const batchDeleteButton =
    selectedKeys.length > 0 ? (
      <Popconfirm
        title={`确认批量删除选中的 ${selectedKeys.length} 条缓存？`}
        onConfirm={handleBatchDeleteKeys}
        okText="确认删除"
        okType="danger"
        cancelText="取消"
      >
        <Button danger loading={batchDeleting} icon={<DeleteOutlined />}>
          批量删除 ({selectedKeys.length})
        </Button>
      </Popconfirm>
    ) : (
      <Tooltip title="勾选下方缓存键后可批量删除">
        <Button disabled icon={<DeleteOutlined />} className="apple-btn-secondary">
          批量删除
        </Button>
      </Tooltip>
    );

  return (
    <div className="space-y-5 min-w-0">
      {/* 顶部控制台二级导航栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            className="apple-btn-secondary"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/console')}
          >
            控制台
          </Button>

          <div
            role="tablist"
            aria-label="控制台子模块"
            className="inline-flex items-center p-1 rounded-full bg-[var(--surface)] border border-[var(--border)]"
          >
            <button
              type="button"
              role="tab"
              aria-selected="true"
              onClick={() => navigate('/console/cache')}
              className="px-3.5 py-1 text-[13px] font-medium rounded-full bg-[var(--accent)] text-[var(--accent-ink)] cursor-pointer"
            >
              缓存监控
            </button>
            <button
              type="button"
              role="tab"
              aria-selected="false"
              onClick={() => navigate('/console/users')}
              className="px-3.5 py-1 text-[13px] font-medium rounded-full text-[var(--ink-2)] hover:text-[var(--ink)] transition-colors cursor-pointer"
            >
              人员管理
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge
            status={stats.server_type === 'real' ? 'success' : 'processing'}
            text={<span className="text-[13px] text-[var(--ink-2)]">{serverLabel}</span>}
          />
          <Button
            className="apple-btn-secondary"
            icon={<ReloadOutlined />}
            onClick={loadCacheData}
          >
            刷新
          </Button>
        </div>
      </div>

      {/* 面板 1：缓存运行概览 */}
      <div className="apple-card p-6">
        <div className="pb-4 mb-5 border-b border-[var(--border)]">
          <h1 className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
            缓存运行概览
          </h1>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricTile
            label="缓存键总数"
            value={stats.total_keys ?? 0}
            icon={<DatabaseOutlined />}
            sub={
              <>
                命中率{' '}
                <span className="num font-medium text-[var(--ink)]">
                  {stats.hit_ratio !== undefined && stats.hit_ratio !== 'N/A'
                    ? `${stats.hit_ratio}%`
                    : '-'}
                </span>
              </>
            }
          />
          <MetricTile
            label="问答结果缓存"
            value={stats.keys_by_prefix?.['Q&A 缓存']?.count ?? 0}
            icon={<ThunderboltOutlined />}
            sub="用户点赞后自动入库"
          />
          <MetricTile
            label="会话上下文"
            value={stats.keys_by_prefix?.['会话缓存']?.count ?? 0}
            icon={<ClockCircleOutlined />}
            sub="多轮对话历史记录"
          />
          <MetricTile
            label="内存占用"
            value={<span className="text-[24px]">{stats.memory_human || '-'}</span>}
            icon={<DatabaseOutlined />}
            sub={
              stats.redis_version && stats.redis_version !== 'N/A'
                ? `引擎版本 ${stats.redis_version}`
                : '当前缓存存储空间'
            }
          />
        </div>
      </div>

      {/* 面板 2：快捷维护与热点预热 */}
      <div className="apple-card p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-[var(--ink-2)] mr-1">快捷清理：</span>
          <Popconfirm
            title="确认清空全部缓存？"
            onConfirm={() => clearCache('all')}
            okText="确认清空"
            okType="danger"
            cancelText="取消"
          >
            <Button danger icon={<DeleteOutlined />}>
              清空全部
            </Button>
          </Popconfirm>
          <Button
            className="apple-btn-secondary"
            icon={<DeleteOutlined />}
            onClick={() => clearCache('qa')}
          >
            清空问答缓存
          </Button>
          <Button
            className="apple-btn-secondary"
            icon={<DeleteOutlined />}
            onClick={() => clearCache('sessions')}
          >
            清空会话缓存
          </Button>
          <Button
            className="apple-btn-secondary"
            icon={<ReloadOutlined />}
            onClick={() => clearCache('hot')}
          >
            重置热门统计
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[13px] text-[var(--ink-2)]">热门预热条数</span>
          <Input
            type="number"
            value={warmupLimit}
            onChange={(e) => setWarmupLimit(Math.max(1, Number(e.target.value) || 1))}
            style={{ width: 80 }}
            min={1}
            aria-label="预热条数"
            className="num"
          />
          <Button
            icon={<FireOutlined />}
            className="apple-btn-primary !px-5"
            onClick={async () => {
              try {
                const r: any = await api.post(`/admin/cache/warmup?limit=${warmupLimit}`);
                message.success(r.message || '预热完成');
                loadCacheData();
              } catch {
                /* 拦截器处理 */
              }
            }}
          >
            热点预热
          </Button>
        </div>
      </div>

      {/* 面板 3：缓存键明细 */}
      <div className="apple-card min-w-0">
        <div className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)]">
          <div className="space-y-0.5">
            <div className="text-[14px] font-medium text-[var(--ink)]">
              缓存键明细（共 <strong className="num">{keys.length}</strong> 条）
            </div>
            <div className="text-[12px] text-[var(--ink-3)]">
              问答缓存来自用户点赞确认；会话历史与热门统计默认保留 7 天
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {batchDeleteButton}
            {selectedKeys.length > 0 && (
              <Button
                type="link"
                size="small"
                onClick={() => setSelectedKeys([])}
                className="!px-1.5"
              >
                取消选择
              </Button>
            )}
            <Input
              value={keyPattern}
              onChange={(e) => setKeyPattern(e.target.value)}
              className="num w-full sm:w-[210px]"
              onPressEnter={loadCacheData}
              prefix={<SearchOutlined className="text-[var(--ink-3)]" />}
              placeholder="输入匹配模式，如 doc:qa:*"
            />
            <Button className="apple-btn-secondary" onClick={loadCacheData}>
              查询
            </Button>
          </div>
        </div>

        <div className="apple-table min-w-0">
          <Table<CacheKeyItem>
            rowKey="key"
            dataSource={keys}
            loading={loadingKeys}
            scroll={{ x: 820 }}
            size="middle"
            rowSelection={{
              columnWidth: 44,
              selectedRowKeys: selectedKeys,
              onChange: (ks) => setSelectedKeys(ks as string[]),
            }}
            pagination={{
              pageSize: 15,
              showSizeChanger: true,
              pageSizeOptions: ['10', '15', '30', '50'],
              showTotal: (t) => <span className="num text-[var(--ink-2)]">共 {t} 条</span>,
            }}
            columns={columns}
          />
        </div>
      </div>

      {/* 单条缓存内容预览抽屉 */}
      <Drawer
        title="缓存条目详情"
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={620}
        loading={detailLoading}
        extra={
          keyDetail && (
            <Popconfirm
              title="确认删除该缓存条目？"
              onConfirm={() => handleDeleteSingleKey(keyDetail.key)}
              okText="删除"
              okType="danger"
              cancelText="取消"
            >
              <Button danger size="small" icon={<DeleteOutlined />}>
                删除条目
              </Button>
            </Popconfirm>
          )
        }
      >
        {keyDetail && (
          <div className="space-y-4">
            <Descriptions
              size="small"
              column={1}
              bordered
              items={[
                {
                  label: '可读描述',
                  children: (
                    <span className="font-medium text-[var(--ink)]">
                      {keyDetail.label || keyDetail.key}
                    </span>
                  ),
                },
                {
                  label: '原始键名',
                  children: <span className="num text-[12px] text-[var(--ink-2)]">{keyDetail.key}</span>,
                },
                {
                  label: '缓存分类',
                  children: <CategoryPill record={keyDetail} />,
                },
                {
                  label: '数据类型',
                  children: <span className="num">{keyDetail.type}</span>,
                },
                {
                  label: '剩余有效期',
                  children: (
                    <span className="num">
                      {formatTtl(keyDetail.ttl)}
                      {keyDetail.ttl >= 0 ? `（${keyDetail.ttl.toLocaleString()} 秒）` : ''}
                    </span>
                  ),
                },
              ]}
            />

            <div>
              <div className="text-[13px] font-medium text-[var(--ink-2)] mb-2">缓存内容预览</div>
              <pre className="m-0 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 text-[12.5px] leading-[1.68] text-[var(--ink)] font-mono whitespace-pre-wrap break-words max-h-[52vh] overflow-y-auto">
                {formatPreviewValue(keyDetail.value)}
              </pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
