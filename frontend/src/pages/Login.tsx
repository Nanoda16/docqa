import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tabs, Form, Input, Button, Alert, message } from 'antd';
import {
  UserOutlined,
  LockOutlined,
  MailOutlined,
  ArrowRightOutlined,
  BookOutlined,
  SearchOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loginForm] = Form.useForm();
  const [registerForm] = Form.useForm();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/chat', { replace: true });
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
        navigate('/chat');
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

  const loginPane = (
    <Form form={loginForm} onFinish={handleLogin} layout="vertical" requiredMark={false} size="large">
      <Form.Item
        name="username"
        label={<span className="text-moon-light">用户名</span>}
        rules={[{ required: true, message: '请输入用户名' }]}
      >
        <Input
          prefix={<UserOutlined className="text-moon-light" />}
          placeholder="请输入用户名"
          autoComplete="username"
        />
      </Form.Item>
      <Form.Item
        name="password"
        label={<span className="text-moon-light">密码</span>}
        rules={[{ required: true, message: '请输入密码' }]}
      >
        <Input.Password
          prefix={<LockOutlined className="text-moon-light" />}
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
        className="btn-champagne mt-3 !h-12 !text-[15px]"
      >
        登录工作台
      </Button>
    </Form>
  );

  const registerPane = (
    <Form
      form={registerForm}
      onFinish={handleRegister}
      layout="vertical"
      requiredMark={false}
      size="large"
    >
      <Form.Item
        name="username"
        label={<span className="text-moon-light">用户名</span>}
        rules={[
          { required: true, message: '请输入用户名' },
          { min: 3, message: '用户名至少 3 个字符' },
        ]}
      >
        <Input
          prefix={<UserOutlined className="text-moon-light" />}
          placeholder="用于登录的唯一账号（至少 3 位）"
          autoComplete="username"
        />
      </Form.Item>
      <Form.Item
        name="password"
        label={<span className="text-moon-light">密码</span>}
        rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}
      >
        <Input.Password
          prefix={<LockOutlined className="text-moon-light" />}
          placeholder="设置登录密码（至少 6 位）"
          autoComplete="new-password"
        />
      </Form.Item>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
        <Form.Item name="nickname" label={<span className="text-moon-light">姓名 / 昵称（可选）</span>}>
          <Input placeholder="用于界面展示" />
        </Form.Item>
        <Form.Item name="email" label={<span className="text-moon-light">邮箱（可选）</span>}>
          <Input
            prefix={<MailOutlined className="text-moon-light" />}
            placeholder="name@company.com"
          />
        </Form.Item>
      </div>
      <Button
        htmlType="submit"
        loading={loading}
        block
        className="btn-champagne mt-3 !h-12 !text-[15px]"
      >
        {needsSetup ? '注册管理员账号' : '创建账号'}
      </Button>
    </Form>
  );

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 sm:px-8">
      <div className="w-full max-w-[1160px] grid lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] gap-10 xl:gap-16 items-center">
        {/* 左侧：夜色视觉叙事（保留大片夜景光斑呼吸感，不套玻璃罩） */}
        <section className="hidden lg:flex flex-col justify-center pr-4">
          <div className="flex items-center gap-3 mb-10">
            <span className="grid place-items-center w-10 h-10 rounded-[14px] bg-white/[0.08] border border-champagne/40 text-champagne text-[18px]">
              <BookOutlined />
            </span>
            <span className="text-[16px] font-medium text-white tracking-tight">
              DocQA · 企业知识库
            </span>
          </div>

          <div className="text-[12px] font-medium text-champagne tracking-[0.14em] mb-4">
            企业级知识检索与智能问答工作台
          </div>
          <h1 className="text-[40px] xl:text-[46px] leading-[1.16] font-semibold text-white tracking-[-0.02em]">
            让团队沉淀的每一份文档，
            <br />
            都成为可追溯的准确答案。
          </h1>
          <p className="mt-5 text-[15px] leading-[1.7] text-moon-light max-w-[500px]">
            支持多格式文档统一维护与增量索引同步，结合向量语义检索与关键词召回，
            让每一次提问都能核对原文依据。
          </p>

          <div className="mt-9 grid grid-cols-1 gap-3.5 max-w-[500px]">
            {[
              {
                icon: <SearchOutlined />,
                title: '双路混合检索',
                desc: '语义向量与关键词全文融合排序，兼顾专有名词与上下文语义。',
              },
              {
                icon: <SafetyCertificateOutlined />,
                title: '引用溯源可核验',
                desc: '每条回答内联标注文献角标，支持一键展开参考片段核对原文。',
              },
              {
                icon: <SyncOutlined />,
                title: '可控的增量索引同步',
                desc: '文档增删改即时入库标记，支持按需增量同步或全量重建索引。',
              },
            ].map((item) => (
              <div key={item.title} className="glass-tile flex items-start gap-3.5 p-4">
                <span className="grid place-items-center w-9 h-9 rounded-[12px] bg-white/[0.06] border border-white/15 text-champagne shrink-0 mt-0.5">
                  {item.icon}
                </span>
                <div>
                  <div className="text-[14px] font-medium text-white">{item.title}</div>
                  <div className="mt-0.5 text-[12.5px] text-moon-light leading-relaxed">
                    {item.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 右侧：唯一主玻璃登录/注册面板 */}
        <section className="w-full max-w-[460px] mx-auto">
          <div className="lg:hidden flex items-center justify-center gap-2.5 mb-7">
            <span className="grid place-items-center w-9 h-9 rounded-[12px] bg-white/[0.08] border border-champagne/40 text-champagne text-[16px]">
              <BookOutlined />
            </span>
            <span className="text-[16px] font-medium text-white">DocQA · 企业知识库</span>
          </div>

          {needsSetup && (
            <Alert
              type="info"
              showIcon
              icon={<InfoCircleOutlined className="!text-champagne" />}
              className="mb-4 !bg-white/[0.08] !border-champagne/40"
              message={<span className="text-white font-medium">系统尚未初始化，请注册首个管理员账号</span>}
              description={
                <span className="text-moon-light text-[12.5px]">
                  首个注册的账号将自动拥有系统管理员权限，可用于管理文档与团队成员。
                </span>
              }
            />
          )}

          <div className="glass-panel glass-panel-interactive p-7 sm:p-8">
            <div className="mb-5">
              <h2 className="text-[22px] font-semibold text-white tracking-tight">
                {activeTab === 'login' ? '欢迎回来' : '创建工作台账号'}
              </h2>
              <p className="mt-1 text-[13px] text-moon-light">
                {activeTab === 'login'
                  ? '请输入您的账号和密码进入知识库'
                  : needsSetup
                    ? '请填写首个管理员账号信息'
                    : '填写基本信息完成账号注册'}
              </p>
            </div>

            <Tabs
              activeKey={activeTab}
              onChange={(k) => setActiveTab(k as 'login' | 'register')}
              items={[
                { key: 'login', label: '账号登录', children: loginPane },
                { key: 'register', label: '注册账号', children: registerPane },
              ]}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
