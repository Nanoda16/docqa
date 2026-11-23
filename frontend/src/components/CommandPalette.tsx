import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  SearchOutlined,
  HomeOutlined,
  MessageOutlined,
  FolderOutlined,
  CloudUploadOutlined,
  ControlOutlined,
  DashboardOutlined,
  TeamOutlined,
  UserOutlined,
  SunOutlined,
  MoonOutlined,
  CloseOutlined,
  EnterOutlined,
} from '@ant-design/icons';
import { useTheme } from '../context/ThemeContext';

interface CommandItem {
  id: string;
  group: string;
  label: string;
  hint: string;
  keywords: string;
  icon: React.ReactNode;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
}

export default function CommandPalette({ open, onClose, isAdmin }: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const { isDark, toggleTheme } = useTheme();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const items = useMemo<CommandItem[]>(() => {
    const go = (path: string) => {
      onClose();
      navigate(path);
    };

    const list: CommandItem[] = [
      {
        id: 'home',
        group: '导航',
        label: '工作台概览',
        hint: '/',
        keywords: 'home workspace 首页 工作台 概览',
        icon: <HomeOutlined />,
        action: () => go('/'),
      },
      {
        id: 'chat',
        group: '导航',
        label: '智能问答',
        hint: '/chat',
        keywords: 'chat qa 对话 问答 检索 ai',
        icon: <MessageOutlined />,
        action: () => go('/chat'),
      },
      {
        id: 'knowledge-list',
        group: '知识库',
        label: '文档列表',
        hint: '/knowledge/list',
        keywords: 'knowledge documents list 文档 知识库 检索 列表',
        icon: <FolderOutlined />,
        action: () => go('/knowledge/list'),
      },
      {
        id: 'knowledge-upload',
        group: '知识库',
        label: '上传与索引同步',
        hint: '/knowledge/upload',
        keywords: 'upload sync index 上传 文档 导入 索引 同步',
        icon: <CloudUploadOutlined />,
        action: () => go('/knowledge/upload'),
      },
    ];

    if (isAdmin) {
      list.push(
        {
          id: 'console',
          group: '系统控制台',
          label: '控制台总览',
          hint: '/console',
          keywords: 'console admin 控制台 管理 总览',
          icon: <ControlOutlined />,
          action: () => go('/console'),
        },
        {
          id: 'console-cache',
          group: '系统控制台',
          label: '缓存监控',
          hint: '/console/cache',
          keywords: 'cache monitor admin 缓存 监控 热点',
          icon: <DashboardOutlined />,
          action: () => go('/console/cache'),
        },
        {
          id: 'console-users',
          group: '系统控制台',
          label: '人员管理',
          hint: '/console/users',
          keywords: 'users team role 人员 用户 权限 角色',
          icon: <TeamOutlined />,
          action: () => go('/console/users'),
        }
      );
    }

    list.push(
      {
        id: 'profile',
        group: '账号与偏好',
        label: '个人中心',
        hint: '/account/profile',
        keywords: 'profile account password 个人 资料 密码 设置',
        icon: <UserOutlined />,
        action: () => go('/account/profile'),
      },
      {
        id: 'toggle-theme',
        group: '账号与偏好',
        label: isDark ? '切换为浅色模式' : '切换为暗色模式',
        hint: isDark ? 'Light' : 'Dark',
        keywords: 'theme dark light 主题 浅色 暗色 深色 外观',
        icon: isDark ? <SunOutlined /> : <MoonOutlined />,
        action: () => {
          toggleTheme();
          onClose();
        },
      }
    );

    return list;
  }, [isAdmin, isDark, navigate, onClose, toggleTheme]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.hint.toLowerCase().includes(q) ||
        item.group.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q)
    );
  }, [items, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  // 控制原生 <dialog> 的打开/关闭，并补充 closedby="any" 兼容兜底
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    dialog.setAttribute('closedby', 'any');

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
      setQuery('');
      setActiveIndex(0);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      onClose();
    };

    // 针对不支持 closedby="any" 的浏览器，通过边界检测实现点击遮罩关闭
    const handleClickOutside = (event: MouseEvent) => {
      if ('closedBy' in HTMLDialogElement.prototype) return;
      const rect = dialog.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inside) {
        dialog.close();
      }
    };

    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('click', handleClickOutside);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('click', handleClickOutside);
    };
  }, [onClose]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex((prev) => (prev + 1) % filtered.length);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = filtered[activeIndex];
      if (target) {
        target.action();
      }
    }
  };

  // 按分组归类但保持扁平索引用于键盘高亮
  const grouped = useMemo(() => {
    const map = new Map<string, Array<{ item: CommandItem; flatIndex: number }>>();
    filtered.forEach((item, idx) => {
      const arr = map.get(item.group) ?? [];
      arr.push({ item, flatIndex: idx });
      map.set(item.group, arr);
    });
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="command-palette-title"
      className="command-dialog"
    >
      <div className="flex flex-col max-h-[min(520px,calc(100vh-96px))]">
        {/* 顶部搜索输入栏 */}
        <div
          className="flex items-center gap-3 px-4 h-13 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <span id="command-palette-title" className="sr-only">
            快速跳转与命令面板
          </span>
          <SearchOutlined style={{ color: 'var(--ink-2)', fontSize: 15 }} aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索页面、路径或操作…"
            aria-label="搜索页面或操作"
            className="flex-1 bg-transparent border-0 outline-none text-[14px]"
            style={{ color: 'var(--ink)' }}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭命令面板"
            className="grid place-items-center w-7 h-7 rounded-full transition-colors"
            style={{ color: 'var(--ink-2)' }}
          >
            <CloseOutlined style={{ fontSize: 12 }} />
          </button>
        </div>

        {/* 命令列表 */}
        <div className="overflow-y-auto p-2 flex-1" role="listbox" aria-label="快捷入口列表">
          {grouped.length === 0 ? (
            <div
              className="py-10 text-center text-[13px]"
              style={{ color: 'var(--ink-2)' }}
            >
              未找到匹配的页面或操作
            </div>
          ) : (
            grouped.map(([group, entries]) => (
              <div key={group} className="mb-2 last:mb-0">
                <div
                  className="px-3 py-1.5 text-[11px] font-medium tracking-wide"
                  style={{ color: 'var(--ink-3)' }}
                >
                  {group}
                </div>
                <ul className="m-0 p-0 list-none">
                  {entries.map(({ item, flatIndex }) => {
                    const selected = flatIndex === activeIndex;
                    return (
                      <li key={item.id} role="option" aria-selected={selected}>
                        <button
                          type="button"
                          onMouseEnter={() => setActiveIndex(flatIndex)}
                          onClick={item.action}
                          className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-[12px] text-left transition-colors"
                          style={{
                            background: selected ? 'var(--surface)' : 'transparent',
                            color: 'var(--ink)',
                          }}
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <span
                              className="grid place-items-center w-7 h-7 rounded-[8px] shrink-0 text-[13px]"
                              style={{
                                background: selected ? 'var(--surface-hover)' : 'var(--surface)',
                                color: 'var(--ink)',
                              }}
                            >
                              {item.icon}
                            </span>
                            <span className="text-[13.5px] font-medium truncate">
                              {item.label}
                            </span>
                          </span>
                          <span
                            className="num text-[11.5px] shrink-0"
                            style={{ color: 'var(--ink-3)' }}
                          >
                            {item.hint}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        {/* 底部快捷键提示 */}
        <div
          className="flex items-center justify-between px-4 py-2.5 text-[11.5px] shrink-0"
          style={{
            borderTop: '1px solid var(--border)',
            color: 'var(--ink-3)',
            background: 'var(--surface)',
          }}
        >
          <span className="flex items-center gap-2">
            <kbd className="kbd-chip">↑</kbd>
            <kbd className="kbd-chip">↓</kbd>
            <span>选择</span>
            <kbd className="kbd-chip">
              <EnterOutlined style={{ fontSize: 10 }} />
            </kbd>
            <span>前往</span>
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="kbd-chip">ESC</kbd>
            <span>关闭</span>
          </span>
        </div>
      </div>
    </dialog>
  );
}
