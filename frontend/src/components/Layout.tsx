import { Avatar, Drawer, Dropdown, Tooltip } from 'antd';
import {
  MessageOutlined,
  FileTextOutlined,
  UserOutlined,
  LogoutOutlined,
  DashboardOutlined,
  TeamOutlined,
  MenuOutlined,
  BookOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getRoleLabel, ROLE_META } from '../types';

interface NavItem {
  key: string;
  icon: React.ReactNode;
  label: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const PAGE_META: Record<string, { title: string; desc: string }> = {
  '/chat': { title: '智能问答', desc: '基于企业知识库的精准检索与对话' },
  '/documents': { title: '知识库文档', desc: '文档维护、向量索引同步与管理' },
  '/profile': { title: '个人中心', desc: '个人资料与账号安全设置' },
  '/users': { title: '人员管理', desc: '成员账号、角色权限与状态控制' },
  '/admin': { title: '缓存监控', desc: '问答缓存运行状态与热点管理' },
};

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navGroups: NavGroup[] = [
    {
      title: '工作台',
      items: [
        { key: '/chat', icon: <MessageOutlined />, label: '智能问答' },
        { key: '/documents', icon: <FileTextOutlined />, label: '知识库文档' },
      ],
    },
  ];

  if (user?.role === 'admin') {
    navGroups.push({
      title: '系统管理',
      items: [
        { key: '/users', icon: <TeamOutlined />, label: '人员管理' },
        { key: '/admin', icon: <DashboardOutlined />, label: '缓存监控' },
      ],
    });
  }

  const meta = PAGE_META[location.pathname] ?? PAGE_META['/chat'];
  const roleLabel = getRoleLabel(user?.role);
  const roleStyle = ROLE_META[user?.role || 'user'] ?? ROLE_META.user;

  const dropdownItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人中心',
      onClick: () => navigate('/profile'),
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

  const handleNavClick = (path: string) => {
    navigate(path);
    setMobileMenuOpen(false);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* 品牌 Logo */}
      <div className="px-4 h-[72px] flex items-center border-b border-white/10 shrink-0">
        <button
          onClick={() => handleNavClick('/chat')}
          className="flex items-center gap-2.5 text-left w-full rounded-btn py-1"
          aria-label="回到智能问答"
        >
          <span className="grid place-items-center w-9 h-9 rounded-[12px] bg-white/[0.08] border border-champagne/40 text-champagne text-[16px] shrink-0">
            <BookOutlined />
          </span>
          <span className="text-[15px] font-medium text-white tracking-tight truncate">
            DocQA · 企业知识库
          </span>
        </button>
      </div>

      {/* 分组导航 */}
      <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-6" aria-label="主导航">
        {navGroups.map((group) => (
          <div key={group.title}>
            <div className="px-3 mb-2 text-[11.5px] font-medium text-moon-light/70">
              {group.title}
            </div>
            <ul className="space-y-1.5">
              {group.items.map((item) => {
                const active = location.pathname === item.key;
                return (
                  <li key={item.key}>
                    <button
                      data-active={active}
                      onClick={() => handleNavClick(item.key)}
                      aria-current={active ? 'page' : undefined}
                      className="nav-item"
                    >
                      <span className={active ? 'text-champagne' : 'text-moon-light'}>
                        {item.icon}
                      </span>
                      <span className="truncate">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* 底部用户信息 */}
      <div className="p-3 border-t border-white/10 shrink-0">
        <div className="glass-tile flex items-center gap-2.5 p-2.5">
          <button
            onClick={() => handleNavClick('/profile')}
            className="flex items-center gap-2.5 min-w-0 flex-1 text-left group"
            title="前往个人中心"
          >
            <Avatar
              size={34}
              src={user?.avatar || undefined}
              className="!bg-white/10 !text-champagne border border-white/15 shrink-0 font-medium"
              icon={!user?.avatar ? <UserOutlined /> : undefined}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-white truncate group-hover:text-champagne transition-colors duration-300">
                {user?.nickname || user?.username || '未登录'}
              </div>
              <div className="mt-1">
                <span
                  className="inline-block px-2 py-0.5 text-[10.5px] font-medium rounded-full leading-none border"
                  style={{
                    color: roleStyle.color,
                    backgroundColor: roleStyle.bg,
                    borderColor: roleStyle.border,
                  }}
                >
                  {roleLabel}
                </span>
              </div>
            </div>
          </button>

          <Tooltip title="退出登录">
            <button
              onClick={handleLogout}
              aria-label="退出登录"
              className="grid place-items-center w-8 h-8 rounded-[12px] text-moon-light hover:text-danger hover:bg-white/10 transition-colors duration-300 shrink-0"
            >
              <LogoutOutlined />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex min-w-0">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-3 focus:py-2 focus:rounded-btn focus:bg-night focus:text-white focus:border focus:border-white/20"
      >
        跳到主要内容
      </a>

      {/* 桌面端玻璃侧栏 */}
      <aside className="hidden md:flex w-[240px] shrink-0 flex-col bg-white/[0.04] backdrop-blur-[40px] backdrop-saturate-[180%] border-r border-white/[0.12]">
        {sidebarContent}
      </aside>

      {/* 移动端抽屉导航 */}
      <Drawer
        placement="left"
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        width={240}
        styles={{ body: { padding: 0 } }}
        closable={false}
      >
        {sidebarContent}
      </Drawer>

      {/* 右侧主画布 */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Night Nav 顶栏 */}
        <header className="h-[72px] shrink-0 px-4 md:px-6 flex items-center justify-between bg-white/[0.04] backdrop-blur-[24px] backdrop-saturate-[180%] border-b border-white/[0.10] min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              aria-label="打开菜单"
              className="md:hidden grid place-items-center w-9 h-9 rounded-[12px] text-moon-light hover:bg-white/10 hover:text-white"
            >
              <MenuOutlined />
            </button>
            <div className="flex items-baseline gap-3 min-w-0">
              <h1 className="text-[16px] font-medium text-white truncate">{meta.title}</h1>
              <span className="hidden sm:inline text-[13px] text-moon-light truncate">
                {meta.desc}
              </span>
            </div>
          </div>

          <Dropdown menu={{ items: dropdownItems }} placement="bottomRight" trigger={['click']}>
            <button className="flex items-center gap-2.5 h-10 px-3 rounded-full bg-white/[0.05] hover:bg-white/[0.12] border border-white/[0.12] transition-all duration-500 ease-liquid shrink-0">
              <Avatar
                size={26}
                src={user?.avatar || undefined}
                className="!bg-white/10 !text-champagne"
                icon={!user?.avatar ? <UserOutlined /> : undefined}
              />
              <span className="hidden sm:inline text-[13px] text-white/90 max-w-[120px] truncate">
                {user?.nickname || user?.username || '用户'}
              </span>
            </button>
          </Dropdown>
        </header>

        <main id="main-content" className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-[1280px] min-w-0 px-4 md:px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
