import { useState, useEffect, useCallback } from 'react';
import {
  Button,
  message,
  Table,
  Tag,
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
  { label: string; color: string; bg: string; border: string }
> = {
  qa: {
    label: '问答缓存 (qa)',
    color: '#e4b863',
    bg: 'rgba(228, 184, 99, 0.14)',
    border: 'rgba(228, 184, 99, 0.35)',
  },
  session: {
    label: '会话历史 (session)',
    color: '#7c9cc4',
    bg: 'rgba(124, 156, 196, 0.14)',
    border: 'rgba(124, 156, 196, 0.35)',
  },
  hot: {
    label: '热门统计 (hot)',
    color: '#34d399',
    bg: 'rgba(52, 211, 153, 0.12)',
    border: 'rgba(52, 211, 153, 0.32)',
  },
  other: {
    label: '其他',
    color: 'rgba(255, 255, 255, 0.78)',
    bg: 'rgba(255, 255, 255, 0.06)',
    border: 'rgba(255, 255, 255, 0.16)',
  },
};

function inferCategory(record: CacheKeyItem): string {
  if (record.category && CATEGORY_META[record.category]) return record.category;
  if (record.key.includes(':qa:')) return 'qa';
  if (record.key.includes(':session:')) return 'session';
  if (record.key.includes(':hot:')) return 'hot';
  return 'other';
}

/**
 * 人性化格式化剩余有效期
 */
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
    <div className="glass-tile p-5">
      <div className="flex items-center gap-2 text-[12px] font-medium text-moon-light">
        <span className="text-moon-light">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-3 num text-[32px] font-semibold leading-none text-white">{value}</div>
      {sub && <div className="mt-2.5 text-[12px] text-moon-light/85">{sub}</div>}
    </div>
  );
}

export default function Admin() {
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
      const res: any = await api.get(
        `/admin/cache/key?key=${encodeURIComponent(key)}`,
      );
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
          className="text-left w-full min-w-0 group"
        >
          <div className="text-[13px] font-medium text-white group-hover:text-champagne transition-colors truncate">
            {record.label || record.key}
          </div>
          <div className="num text-[11.5px] text-moon-light truncate">{record.key}</div>
        </button>
      ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 150,
      render: (_: string, record: CacheKeyItem) => {
        const cat = inferCategory(record);
        const meta = CATEGORY_META[cat] ?? CATEGORY_META.other;
        return (
          <Tag
            className="!m-0 font-medium"
            style={{
              color: meta.color,
              backgroundColor: meta.bg,
              borderColor: meta.border,
            }}
          >
            {meta.label}
          </Tag>
        );
      },
    },
    {
      title: '数据类型',
      dataIndex: 'type',
      width: 100,
      render: (t: string) => (
        <Tag className="!m-0 !bg-white/[0.06] !border-white/15 !text-moon-light">{t}</Tag>
      ),
    },
    {
      title: '剩余有效期',
      dataIndex: 'ttl',
      width: 145,
      render: (t: number) => (
        <Tooltip title={t >= 0 ? `精确剩余：${t.toLocaleString()} 秒` : `原始 TTL：${t}`}>
          <span className="num text-white/90 whitespace-nowrap cursor-help">
            {formatTtl(t)}
          </span>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
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
        <Button
          danger
          loading={batchDeleting}
          icon={<DeleteOutlined />}
          className="!rounded-btn !border-danger/50 !bg-danger/15 !text-danger hover:!bg-danger/25"
        >
          批量删除 ({selectedKeys.length})
        </Button>
      </Popconfirm>
    ) : (
      <Tooltip title="勾选下方缓存键后可批量删除">
        <Button disabled icon={<DeleteOutlined />} className="btn-glass">
          批量删除
        </Button>
      </Tooltip>
    );

  return (
    <div className="space-y-5 min-w-0">
      {/* 玻璃面板 1：缓存运行概览 */}
      <div className="glass-panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-5 border-b border-white/10">
          <div>
            <h2 className="text-[16px] font-semibold text-white">缓存运行概览</h2>
            <p className="mt-1 text-[13px] text-moon-light">
              实时监控问答结果缓存、会话上下文与内存占用
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge
              status={stats.server_type === 'real' ? 'success' : 'processing'}
              text={<span className="text-[13px] text-moon-light">{serverLabel}</span>}
            />
            <Button className="btn-glass" icon={<ReloadOutlined />} onClick={loadCacheData}>
              立即刷新
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricTile
            label="缓存键总数"
            value={stats.total_keys ?? 0}
            icon={<DatabaseOutlined />}
            sub={
              <>
                命中率{' '}
                <span className="num font-medium text-white">
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

      {/* 玻璃面板 2：快捷维护与热点预热（唯一香槟金主 CTA = 热点预热） */}
      <div className="glass-panel p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[13px] font-medium text-moon-light mr-1">快捷清理：</span>
          <Popconfirm
            title="确认清空全部缓存？"
            onConfirm={() => clearCache('all')}
            okText="确认清空"
            okType="danger"
            cancelText="取消"
          >
            <Button
              danger
              icon={<DeleteOutlined />}
              className="!rounded-btn !bg-danger/10 !border-danger/40 !text-danger hover:!bg-danger/20"
            >
              清空全部
            </Button>
          </Popconfirm>
          <Button className="btn-glass" icon={<DeleteOutlined />} onClick={() => clearCache('qa')}>
            清空问答缓存
          </Button>
          <Button
            className="btn-glass"
            icon={<DeleteOutlined />}
            onClick={() => clearCache('sessions')}
          >
            清空会话缓存
          </Button>
          <Button className="btn-glass" icon={<ReloadOutlined />} onClick={() => clearCache('hot')}>
            重置热门统计
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[13px] text-moon-light">热门预热条数</span>
          <Input
            type="number"
            value={warmupLimit}
            onChange={(e) => setWarmupLimit(Math.max(1, Number(e.target.value) || 1))}
            style={{ width: 80 }}
            min={1}
            aria-label="预热条数"
          />
          <Button
            icon={<FireOutlined />}
            className="btn-champagne !px-5"
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

      {/* 玻璃面板 3：缓存键明细（支持单条查看/删除与批量勾选删除） */}
      <div className="glass-panel min-w-0">
        <div className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] bg-white/[0.03]">
          <div className="space-y-0.5">
            <div className="text-[13px] font-medium text-white">
              缓存键明细（共 <strong className="num text-champagne">{keys.length}</strong> 条）
            </div>
            <div className="text-[12px] text-moon-light">
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
              style={{ width: 210 }}
              onPressEnter={loadCacheData}
              prefix={<SearchOutlined className="text-moon-light" />}
              placeholder="输入匹配模式，如 doc:qa:*"
              className="num"
            />
            <Button className="btn-glass" onClick={loadCacheData}>
              查询
            </Button>
          </div>
        </div>

        <div className="glass-table min-w-0">
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
              showTotal: (t) => <span className="text-moon-light">共 {t} 条</span>,
            }}
            columns={columns}
          />
        </div>
      </div>

      {/* 单条缓存内容预览抽屉 */}
      <Drawer
        title={<span className="text-white">缓存条目详情</span>}
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
              <Button
                danger
                size="small"
                icon={<DeleteOutlined />}
                className="!rounded-btn !bg-danger/10 !border-danger/40 !text-danger hover:!bg-danger/20"
              >
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
                    <span className="font-medium text-white">
                      {keyDetail.label || keyDetail.key}
                    </span>
                  ),
                },
                {
                  label: '原始键名',
                  children: <span className="num text-[12px] text-moon-light">{keyDetail.key}</span>,
                },
                {
                  label: '缓存分类',
                  children: (() => {
                    const cat = inferCategory(keyDetail);
                    const meta = CATEGORY_META[cat] ?? CATEGORY_META.other;
                    return (
                      <Tag
                        className="!m-0"
                        style={{
                          color: meta.color,
                          backgroundColor: meta.bg,
                          borderColor: meta.border,
                        }}
                      >
                        {meta.label}
                      </Tag>
                    );
                  })(),
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
              <div className="text-[13px] font-medium text-moon-light mb-2">缓存内容预览</div>
              <pre className="m-0 rounded-[16px] border border-white/12 bg-night-deep/65 p-4 text-[12.5px] leading-[1.68] text-white/90 font-mono whitespace-pre-wrap break-words max-h-[52vh] overflow-y-auto">
                {formatPreviewValue(keyDetail.value)}
              </pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
