import { useState, useEffect, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, message } from 'antd';
import {
  UserOutlined,
  LockOutlined,
  MailOutlined,
  ArrowRightOutlined,
  SunOutlined,
  MoonOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

type AuthTab = 'login' | 'register';

export default function Login() {
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<AuthTab>('login');
  const [loading, setLoading] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loginForm] = Form.useForm();
  const [registerForm] = Form.useForm();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    let mounted = true;
    api
      .get('/user/setup-status', { silentError: true })
      .then((res: any) => {
        if (!mounted) return;
        if (res?.code === 200 && res?.data?.initialized === false) {
          setNeedsSetup(true);
          setActiveTab('register');
        }
      })
      .catch(() => {
        /* 忽略预检失败 */
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleLogin = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res: any = await api.post('/user/login', values);
      if (res.code === 200) {
        login(res.data.access_token, res.data.user);
        message.success('登录成功');
        navigate('/', { replace: true });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (values: {
    username: string;
    password: string;
    nickname?: string;
    email?: string;
  }) => {
    setLoading(true);
    try {
      const res: any = await api.post('/user/register', values);
      if (res.code === 200) {
        message.success(needsSetup ? '首个管理员账号注册成功，请登录' : '注册成功，请登录');
        setNeedsSetup(false);
        registerForm.resetFields();
        loginForm.setFieldsValue({ username: values.username, password: '' });
        setActiveTab('login');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'Home') {
      e.preventDefault();
      setActiveTab('login');
    } else if (e.key === 'ArrowRight' || e.key === 'End') {
      e.preventDefault();
      setActiveTab('register');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--ink)]">
      {/* 极简顶栏：品牌名 + 明暗主题切换 */}
      <header className="w-full max-w-[1120px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid place-items-center w-7 h-7 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] text-[13px] font-semibold tracking-tight"
          >
            D
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
            DocQA
          </span>
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={isDark ? '切换为浅色主题' : '切换为深色主题'}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-[12.5px] font-medium text-[var(--ink-2)] hover:text-[var(--ink)] hover:border-[var(--border-strong)] transition-colors"
        >
          {isDark ? <SunOutlined className="text-[13px]" /> : <MoonOutlined className="text-[13px]" />}
          <span>{isDark ? '浅色' : '深色'}</span>
        </button>
      </header>

      {/* 主内容区：单栏居中登录/注册卡片 */}
      <main className="flex-1 flex items-center justify-center px-4 pb-12 pt-4">
        <div className="w-full max-w-[420px]">
          <div className="text-center mb-7">
            <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-[-0.03em] text-[var(--ink)] leading-tight">
              {activeTab === 'login' ? '登录 DocQA' : needsSetup ? '初始化管理员' : '创建账号'}
            </h1>
            {needsSetup && (
              <p className="mt-2 text-[13px] text-[var(--ink-2)]">
                首次使用需注册系统管理员账号
              </p>
            )}
          </div>

          {needsSetup && (
            <div
              role="status"
              className="mb-4 flex items-start gap-2.5 px-4 py-3 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] text-[12.5px] leading-relaxed text-[var(--ink-2)]"
            >
              <InfoCircleOutlined className="text-[var(--ink)] mt-0.5 shrink-0" />
              <span>首个注册的账号将自动获得管理员权限，用于管理知识库与成员。</span>
            </div>
          )}

          <div className="apple-card p-6 sm:p-8">
            {/* 分段切换：账号登录 / 注册账号 */}
            <div
              role="tablist"
              aria-label="认证方式"
              onKeyDown={handleTabKeyDown}
              className="grid grid-cols-2 p-1 mb-6 rounded-full bg-[var(--surface)] border border-[var(--border)]"
            >
              {(
                [
                  { key: 'login', label: '账号登录' },
                  { key: 'register', label: '注册账号' },
                ] as const
              ).map((tab) => {
                const selected = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    id={`auth-tab-${tab.key}`}
                    aria-selected={selected}
                    aria-controls={`auth-panel-${tab.key}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActiveTab(tab.key)}
                    className={`h-9 rounded-full text-[13.5px] font-medium transition-colors ${
                      selected
                        ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                        : 'text-[var(--ink-2)] hover:text-[var(--ink)]'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {activeTab === 'login' ? (
              <div role="tabpanel" id="auth-panel-login" aria-labelledby="auth-tab-login">
                <Form
                  form={loginForm}
                  onFinish={handleLogin}
                  layout="vertical"
                  requiredMark={false}
                  size="large"
                >
                  <Form.Item
                    name="username"
                    label={<span className="text-[13px] font-medium text-[var(--ink)]">用户名</span>}
                    rules={[{ required: true, message: '请输入用户名' }]}
                  >
                    <Input
                      prefix={<UserOutlined className="text-[var(--ink-3)]" />}
                      placeholder="请输入用户名"
                      autoComplete="username"
                    />
                  </Form.Item>
                  <Form.Item
                    name="password"
                    label={<span className="text-[13px] font-medium text-[var(--ink)]">密码</span>}
                    rules={[{ required: true, message: '请输入密码' }]}
                  >
                    <Input.Password
                      prefix={<LockOutlined className="text-[var(--ink-3)]" />}
                      placeholder="请输入密码"
                      autoComplete="current-password"
                    />
                  </Form.Item>
                  <Button
                    htmlType="submit"
                    loading={loading}
                    block
                    icon={<ArrowRightOutlined />}
                    iconPosition="end"
                    className="apple-btn-primary mt-2 !h-11 !text-[14.5px]"
                  >
                    登录
                  </Button>
                </Form>
              </div>
            ) : (
              <div role="tabpanel" id="auth-panel-register" aria-labelledby="auth-tab-register">
                <Form
                  form={registerForm}
                  onFinish={handleRegister}
                  layout="vertical"
                  requiredMark={false}
                  size="large"
                >
                  <Form.Item
                    name="username"
                    label={<span className="text-[13px] font-medium text-[var(--ink)]">用户名</span>}
                    rules={[
                      { required: true, message: '请输入用户名' },
                      { min: 3, message: '用户名至少 3 个字符' },
                    ]}
                  >
                    <Input
                      prefix={<UserOutlined className="text-[var(--ink-3)]" />}
                      placeholder="至少 3 位字符"
                      autoComplete="username"
                    />
                  </Form.Item>
                  <Form.Item
                    name="password"
                    label={<span className="text-[13px] font-medium text-[var(--ink)]">密码</span>}
                    rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}
                  >
                    <Input.Password
                      prefix={<LockOutlined className="text-[var(--ink-3)]" />}
                      placeholder="至少 6 位字符"
                      autoComplete="new-password"
                    />
                  </Form.Item>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
                    <Form.Item
                      name="nickname"
                      label={<span className="text-[13px] font-medium text-[var(--ink)]">昵称（可选）</span>}
                    >
                      <Input placeholder="用于界面显示" />
                    </Form.Item>
                    <Form.Item
                      name="email"
                      label={<span className="text-[13px] font-medium text-[var(--ink)]">邮箱（可选）</span>}
                    >
                      <Input
                        prefix={<MailOutlined className="text-[var(--ink-3)]" />}
                        placeholder="name@company.com"
                      />
                    </Form.Item>
                  </div>
                  <Button
                    htmlType="submit"
                    loading={loading}
                    block
                    className="apple-btn-primary mt-2 !h-11 !text-[14.5px]"
                  >
                    {needsSetup ? '注册管理员账号' : '创建账号'}
                  </Button>
                </Form>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
