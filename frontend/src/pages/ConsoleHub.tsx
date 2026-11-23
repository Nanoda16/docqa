import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DatabaseOutlined,
  TeamOutlined,
  RightOutlined,
  ReloadOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons';
import { Button } from 'antd';
import api from '../services/api';

interface CacheSummary {
  total_keys?: number;
  hit_ratio?: number | string;
  memory_human?: string;
  server_type?: string;
}

export default function ConsoleHub() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [cacheSummary, setCacheSummary] = useState<CacheSummary | null>(null);
  const [userTotal, setUserTotal] = useState<number | null>(null);

  const loadOverview = async () => {
    setLoading(true);
    try {
      const [cacheRes, userRes]: any[] = await Promise.allSettled([
        api.get('/admin/cache/stats', { silentError: true }),
        api.get('/user/list?page=1&page_size=1', { silentError: true }),
      ]);

      if (cacheRes.status === 'fulfilled' && cacheRes.value?.code === 200) {
        setCacheSummary(cacheRes.value.data || {});
      }
      if (userRes.status === 'fulfilled' && userRes.value?.code === 200) {
        setUserTotal(userRes.value.data?.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const serverLabel =
    cacheSummary?.server_type === 'real'
      ? 'Redis 实时服务'
      : cacheSummary?.server_type === 'sqlite'
        ? 'SQLite 持久化降级'
        : cacheSummary?.server_type
          ? '本地内存降级'
          : '状态同步中';

  return (
    <div className="space-y-6 min-w-0">
      {/* 顶部标题与操作栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-[var(--ink)]">
            管理员控制台
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            className="apple-btn-secondary"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/')}
          >
            返回工作台
          </Button>
          <Button
            className="apple-btn-secondary"
            icon={<ReloadOutlined spin={loading} />}
            onClick={loadOverview}
          >
            刷新
          </Button>
        </div>
      </div>

      {/* 两个核心二级域入口卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* 入口 1：缓存监控 */}
        <button
          type="button"
          onClick={() => navigate('/console/cache')}
          className="apple-card group text-left p-6 flex flex-col justify-between gap-6 transition-all duration-200 hover:border-[var(--border-strong)] cursor-pointer"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-[14px] bg-[var(--surface)] border border-[var(--border)] grid place-items-center text-[18px] text-[var(--ink)] shrink-0">
                <DatabaseOutlined />
              </div>
              <div>
                <h2 className="text-[16px] font-semibold text-[var(--ink)]">缓存监控</h2>
                <p className="mt-0.5 text-[13px] text-[var(--ink-2)]">
                  问答缓存、会话上下文管理与热点预热
                </p>
              </div>
            </div>
            <RightOutlined className="text-[13px] text-[var(--ink-3)] group-hover:text-[var(--ink)] group-hover:translate-x-0.5 transition-all mt-1.5 shrink-0" />
          </div>

          <div className="grid grid-cols-3 gap-3 pt-4 border-t border-[var(--border)]">
            <div>
              <div className="text-[11.5px] text-[var(--ink-3)]">缓存键数</div>
              <div className="mt-1 num text-[20px] font-semibold text-[var(--ink)]">
                {cacheSummary?.total_keys ?? '-'}
              </div>
            </div>
            <div>
              <div className="text-[11.5px] text-[var(--ink-3)]">命中率</div>
              <div className="mt-1 num text-[20px] font-semibold text-[var(--ink)]">
                {cacheSummary?.hit_ratio !== undefined && cacheSummary?.hit_ratio !== 'N/A'
                  ? `${cacheSummary.hit_ratio}%`
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-[11.5px] text-[var(--ink-3)]">运行引擎</div>
              <div className="mt-1.5 text-[13px] font-medium text-[var(--ink-2)] truncate">
                {serverLabel}
              </div>
            </div>
          </div>
        </button>

        {/* 入口 2：人员管理 */}
        <button
          type="button"
          onClick={() => navigate('/console/users')}
          className="apple-card group text-left p-6 flex flex-col justify-between gap-6 transition-all duration-200 hover:border-[var(--border-strong)] cursor-pointer"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-[14px] bg-[var(--surface)] border border-[var(--border)] grid place-items-center text-[18px] text-[var(--ink)] shrink-0">
                <TeamOutlined />
              </div>
              <div>
                <h2 className="text-[16px] font-semibold text-[var(--ink)]">人员管理</h2>
                <p className="mt-0.5 text-[13px] text-[var(--ink-2)]">
                  成员账号创建、角色权限分配与状态维护
                </p>
              </div>
            </div>
            <RightOutlined className="text-[13px] text-[var(--ink-3)] group-hover:text-[var(--ink)] group-hover:translate-x-0.5 transition-all mt-1.5 shrink-0" />
          </div>

          <div className="grid grid-cols-3 gap-3 pt-4 border-t border-[var(--border)]">
            <div>
              <div className="text-[11.5px] text-[var(--ink-3)]">成员总数</div>
              <div className="mt-1 num text-[20px] font-semibold text-[var(--ink)]">
                {userTotal ?? '-'}
              </div>
            </div>
            <div className="col-span-2 flex items-end justify-end">
              <span className="text-[13px] font-medium text-[var(--ink-2)] group-hover:text-[var(--ink)] transition-colors">
                进入人员列表
              </span>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
