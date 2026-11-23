import { useEffect, useMemo, useState } from 'react';
import { Avatar, Drawer, Dropdown, Tooltip } from 'antd';
import {
  UserOutlined,
  LogoutOutlined,
  MenuOutlined,
  SearchOutlined,
  SunOutlined,
  MoonOutlined,
  ArrowLeftOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { getRoleLabel } from '../types';
import CommandPalette from './CommandPalette';

interface TopNavItem {
  key: string;
  label: string;
  matchPrefix?: string;
}

interface Crumb {
  label: string;
  path?: string;
}

function getBreadcrumbs(pathname: string): { crumbs: Crumb[]; parentPath: string } | null {
  if (pathname === '/' || pathname === '') return null;

  if (pathname === '/chat') {
    return {
      crumbs: [{ label: '工作台', path: '/' }, { label: '智能问答' }],
      parentPath: '/',
    };
  }
  if (pathname === '/knowledge/list' || pathname === '/knowledge') {
    return {
      crumbs: [
        { label: '工作台', path: '/' },
        { label: '知识库', path: '/knowledge/list' },
        { label: '文档列表' },
      ],
      parentPath: '/',
    };
  }
  if (pathname === '/knowledge/upload') {
    return {
      crumbs: [
        { label: '工作台', path: '/' },
        { label: '知识库', path: '/knowledge/list' },
        { label: '上传与索引' },
      ],
      parentPath: '/knowledge/list',
    };
  }
  if (pathname === '/console') {
    return {
      crumbs: [{ label: '工作台', path: '/' }, { label: '系统控制台' }],
      parentPath: '/',
    };
  }
  if (pathname === '/console/cache') {
    return {
      crumbs: [
        { label: '工作台', path: '/' },
        { label: '系统控制台', path: '/console' },
        { label: '缓存监控' },
      ],
      parentPath: '/console',
    };
  }
  if (pathname === '/console/users') {
    return {
      crumbs: [
        { label: '工作台', path: '/' },
        { label: '系统控制台', path: '/console' },
        { label: '人员管理' },
      ],
      parentPath: '/console',
    };
  }
  if (pathname === '/account/profile') {
    return {
      crumbs: [{ label: '工作台', path: '/' }, { label: '个人中心' }],
      parentPath: '/',
    };
  }

  return {
    crumbs: [{ label: '工作台', path: '/' }],
    parentPath: '/',
  };
}

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const isAdmin = user?.role === 'admin';
  const isChatRoute = location.pathname === '/chat';

  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

  // 全局 Cmd/Ctrl + K 快捷键唤醒命令面板
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const topNavItems = useMemo<TopNavItem[]>(() => {
    const base: TopNavItem[] = [
      { key: '/', label: '工作台' },
      { key: '/chat', label: '智能问答', matchPrefix: '/chat' },
      { key: '/knowledge/list', label: '知识库', matchPrefix: '/knowledge' },
    ];
    if (isAdmin) {
      base.push({ key: '/console', label: '控制台', matchPrefix: '/console' });
    }
    return base;
  }, [isAdmin]);

  const isNavActive = (item: TopNavItem) => {
    if (item.key === '/') return location.pathname === '/';
    if (item.matchPrefix) return location.pathname.startsWith(item.matchPrefix);
    return location.pathname === item.key;
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleNavClick = (path: string) => {
    navigate(path);
    setMobileMenuOpen(false);
  };

  const roleLabel = getRoleLabel(user?.role);
  const displayName = user?.nickname || user?.username || '用户';
  const breadcrumbData = getBreadcrumbs(location.pathname);

  const dropdownItems = [
    {
      key: 'identity',
      disabled: true,
      label: (
        <div className="py-1 cursor-default">
          <div className="text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
            {displayName}
          </div>
          <div className="text-[11.5px]" style={{ color: 'var(--ink-2)' }}>
            {roleLabel}
          </div>
        </div>
      ),
    },
    { type: 'divider' as const },
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人中心',
      onClick: () => navigate('/account/profile'),
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
      onClick: handleLogout,
    },
  ];

  return (
    <div
      className="min-h-screen flex flex-col min-w-0"
      style={{ background: 'var(--bg)', color: 'var(--ink)' }}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-3 focus:py-2 focus:rounded-full"
        style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
      >
        跳到主要内容
      </a>

      {/* 顶层粘性毛玻璃导航栏 */}
      <header className="sticky top-0 z-40 h-14 shrink-0 apple-header">
        <div className="mx-auto h-full w-full max-w-[1360px] px-4 sm:px-6 flex items-center justify-between gap-3">
          {/* 左侧：移动端菜单 + 品牌名 + 桌面端顶层域导航 */}
          <div className="flex items-center gap-3 sm:gap-6 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="打开导航菜单"
              className="md:hidden grid place-items-center w-8 h-8 rounded-full transition-colors"
              style={{ color: 'var(--ink)' }}
            >
              <MenuOutlined style={{ fontSize: 15 }} />
            </button>

            <button
              type="button"
              onClick={() => handleNavClick('/')}
              className="flex items-center gap-2 shrink-0 text-left bg-transparent border-0 p-0 cursor-pointer"
              aria-label="返回 DocQA 工作台"
            >
              <span
                className="grid place-items-center w-6 h-6 rounded-[7px] text-[12px] font-semibold tracking-tight"
                style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
              >
                D
              </span>
              <span
                className="text-[15px] font-semibold tracking-[-0.02em]"
                style={{ color: 'var(--ink)' }}
              >
                DocQA
              </span>
            </button>

            <nav className="hidden md:flex items-center gap-1" aria-label="顶层域导航">
              {topNavItems.map((item) => {
                const active = isNavActive(item);
                return (
                  <button
                    key={item.key}
                    type="button"
                    data-active={active}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => handleNavClick(item.key)}
                    className="top-nav-link"
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* 右侧：命令面板触发器 + 主题切换 + 用户菜单 */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="打开快速跳转命令面板"
              className="flex items-center gap-2 h-8 px-2.5 sm:px-3 rounded-full text-[12.5px] transition-colors cursor-pointer"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--ink-2)',
              }}
            >
              <SearchOutlined style={{ fontSize: 12.5 }} />
              <span className="hidden sm:inline">快速跳转</span>
              <kbd className="kbd-chip hidden sm:inline-flex">⌘K</kbd>
            </button>

            <Tooltip title={isDark ? '切换为浅色模式' : '切换为暗色模式'}>
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={isDark ? '切换为浅色模式' : '切换为暗色模式'}
                className="grid place-items-center w-8 h-8 rounded-full transition-colors cursor-pointer"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--ink)',
                }}
              >
                {isDark ? (
                  <SunOutlined style={{ fontSize: 13.5 }} />
                ) : (
                  <MoonOutlined style={{ fontSize: 13.5 }} />
                )}
              </button>
            </Tooltip>

            <Dropdown
              menu={{ items: dropdownItems }}
              placement="bottomRight"
              trigger={['click']}
            >
              <button
                type="button"
                aria-label="打开用户菜单"
                className="flex items-center gap-2 h-8 pl-1 pr-2.5 rounded-full transition-colors cursor-pointer"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--ink)',
                }}
              >
                <Avatar
                  size={22}
                  src={user?.avatar || undefined}
                  style={{
                    backgroundColor: 'var(--accent)',
                    color: 'var(--accent-ink)',
                    fontSize: 11,
                  }}
                  icon={!user?.avatar ? <UserOutlined /> : undefined}
                />
                <span className="hidden sm:inline text-[12.5px] font-medium max-w-[100px] truncate">
                  {displayName}
                </span>
              </button>
            </Dropdown>
          </div>
        </div>
      </header>

      {/* 移动端导航抽屉（仅展示顶层域 + 个人中心） */}
      <Drawer
        placement="left"
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        width={260}
        title="DocQA"
      >
        <nav className="flex flex-col gap-1" aria-label="移动端主导航">
          {topNavItems.map((item) => {
            const active = isNavActive(item);
            return (
              <button
                key={item.key}
                type="button"
                data-active={active}
                onClick={() => handleNavClick(item.key)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-[12px] text-[14px] font-medium text-left transition-colors"
                style={{
                  background: active ? 'var(--surface)' : 'transparent',
                  color: active ? 'var(--ink)' : 'var(--ink-2)',
                }}
              >
                <span>{item.label}</span>
                <RightOutlined style={{ fontSize: 11, opacity: 0.45 }} />
              </button>
            );
          })}

          <div className="my-3" style={{ borderTop: '1px solid var(--border)' }} />

          <button
            type="button"
            onClick={() => handleNavClick('/account/profile')}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[12px] text-[14px] text-left"
            style={{ color: 'var(--ink-2)' }}
          >
            <UserOutlined />
            <span>个人中心</span>
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[12px] text-[14px] text-left"
            style={{ color: 'var(--status-danger)' }}
          >
            <LogoutOutlined />
            <span>退出登录</span>
          </button>
        </nav>
      </Drawer>

      {/* 主内容区域 */}
      <main id="main-content" className="flex-1 min-w-0 flex flex-col">
        <div
          className={`mx-auto w-full min-w-0 px-4 sm:px-6 ${
            isChatRoute ? 'max-w-[1360px] py-4 flex-1 flex flex-col' : 'max-w-[1160px] py-6 sm:py-8'
          }`}
        >
          {/* 二级/三级页面统一面包屑与返回上级 */}
          {breadcrumbData && (
            <div className="mb-4 sm:mb-5 flex items-center justify-between gap-3 flex-wrap">
              <nav
                aria-label="当前位置"
                className="flex items-center gap-2 text-[12.5px] min-w-0"
                style={{ color: 'var(--ink-2)' }}
              >
                <button
                  type="button"
                  onClick={() => navigate(breadcrumbData.parentPath)}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full transition-colors cursor-pointer shrink-0"
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    color: 'var(--ink)',
                  }}
                >
                  <ArrowLeftOutlined style={{ fontSize: 11 }} />
                  <span>返回</span>
                </button>

                <ol className="flex items-center gap-1.5 m-0 p-0 list-none min-w-0 overflow-hidden">
                  {breadcrumbData.crumbs.map((crumb, idx) => {
                    const isLast = idx === breadcrumbData.crumbs.length - 1;
                    return (
                      <li key={crumb.label} className="flex items-center gap-1.5 min-w-0">
                        {idx > 0 && (
                          <span aria-hidden style={{ color: 'var(--ink-3)' }}>
                            /
                          </span>
                        )}
                        {crumb.path && !isLast ? (
                          <button
                            type="button"
                            onClick={() => navigate(crumb.path!)}
                            className="bg-transparent border-0 p-0 cursor-pointer hover:underline truncate"
                            style={{ color: 'var(--ink-2)' }}
                          >
                            {crumb.label}
                          </button>
                        ) : (
                          <span
                            className="font-medium truncate"
                            style={{ color: 'var(--ink)' }}
                            aria-current={isLast ? 'page' : undefined}
                          >
                            {crumb.label}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </nav>
            </div>
          )}

          <Outlet />
        </div>
      </main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        isAdmin={isAdmin}
      />
    </div>
  );
}
