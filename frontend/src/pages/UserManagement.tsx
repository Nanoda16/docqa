import { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Tag,
  Select,
  Button,
  Modal,
  Form,
  Input,
  message,
  Popconfirm,
  Tooltip,
  Space,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  KeyOutlined,
} from '@ant-design/icons';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { UserProfile } from '../types';

const ROLE_OPTIONS = [
  { label: '普通用户', value: 'user' },
  { label: '编辑者', value: 'editor' },
  { label: '管理员', value: 'admin' },
];

export default function UserManagement() {
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  /* 统一查询状态：任何筛选或搜索变更均同步重置 page = 1 */
  const [query, setQuery] = useState<{
    page: number;
    pageSize: number;
    keyword: string;
    role?: string;
    status?: number;
  }>({
    page: 1,
    pageSize: 20,
    keyword: '',
    role: undefined,
    status: undefined,
  });
  const [keywordInput, setKeywordInput] = useState('');

  /* 新增 / 编辑弹窗 */
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'create' | 'edit'>('create');
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  /* 重置密码弹窗 */
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserProfile | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetForm] = Form.useForm();

  /* 搜索防抖重置 page = 1 */
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery((prev) => {
        const trimmed = keywordInput.trim();
        if (prev.keyword === trimmed) return prev;
        return { ...prev, keyword: trimmed, page: 1 };
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [keywordInput]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(query.page),
        page_size: String(query.pageSize),
      });
      if (query.keyword) params.set('keyword', query.keyword);
      if (query.role) params.set('role', query.role);
      if (query.status !== undefined) params.set('status', String(query.status));

      const res: any = await api.get(`/user/list?${params}`);
      if (res?.code === 200) {
        setUsers(res.data?.items || []);
        setTotal(res.data?.total || 0);
      }
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const openCreate = () => {
    setModalType('create');
    setEditingUser(null);
    form.resetFields();
    form.setFieldsValue({ role: 'user' });
    setModalOpen(true);
  };

  const openEdit = (u: UserProfile) => {
    setModalType('edit');
    setEditingUser(u);
    form.setFieldsValue({ nickname: u.nickname || '', email: u.email || '' });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (modalType === 'create') {
        await api.post('/user/admin/create', {
          ...values,
          password: values.password || '123456',
        });
        message.success('用户创建成功');
        setModalOpen(false);
        if (query.page !== 1) {
          setQuery((prev) => ({ ...prev, page: 1 }));
        } else {
          loadUsers();
        }
      } else if (editingUser) {
        await api.put(`/user/${editingUser.id}`, values);
        message.success('用户信息已更新');
        setModalOpen(false);
        loadUsers();
      }
    } catch {
      /* 表单或接口异常 */
    } finally {
      setSubmitting(false);
    }
  };

  const openResetPassword = (u: UserProfile) => {
    setResetTarget(u);
    resetForm.resetFields();
    setResetModalOpen(true);
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    try {
      const values = await resetForm.validateFields();
      setResetting(true);
      await api.put(`/user/${resetTarget.id}/reset-password`, {
        new_password: values.new_password,
      });
      message.success(`已重置「${resetTarget.username}」的密码`);
      setResetModalOpen(false);
    } catch {
      /* 表单或接口异常 */
    } finally {
      setResetting(false);
    }
  };

  const updateRole = async (id: number, role: string) => {
    try {
      await api.put(`/user/${id}/role?role=${role}`);
      message.success('角色已更新');
      loadUsers();
    } catch {
      /* 拦截器处理 */
    }
  };

  const toggleStatus = async (id: number, status: number) => {
    try {
      await api.put(`/user/${id}/status?status=${status}`);
      message.success(status === 1 ? '已启用账号' : '已禁用账号');
      loadUsers();
    } catch {
      /* 拦截器处理 */
    }
  };

  const deleteUser = async (id: number) => {
    try {
      await api.delete(`/user/${id}`);
      message.success('用户已永久删除');
      if (users.length <= 1 && query.page > 1) {
        setQuery((prev) => ({ ...prev, page: prev.page - 1 }));
      } else {
        loadUsers();
      }
    } catch {
      /* 拦截器处理 */
    }
  };

  return (
    <div className="space-y-5 min-w-0">
      {/* 玻璃面板 1：筛选工具栏 */}
      <div className="glass-panel p-4 flex flex-wrap items-center gap-2.5">
        <Input
          placeholder="搜索用户名 / 昵称 / 邮箱"
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onPressEnter={() =>
            setQuery((prev) => ({ ...prev, keyword: keywordInput.trim(), page: 1 }))
          }
          prefix={<SearchOutlined className="text-moon-light" />}
          style={{ width: 250 }}
          allowClear
        />
        <Select
          placeholder="全部角色"
          value={query.role}
          onChange={(v) => setQuery((prev) => ({ ...prev, role: v, page: 1 }))}
          allowClear
          style={{ width: 130 }}
          options={ROLE_OPTIONS}
        />
        <Select
          placeholder="全部状态"
          value={query.status}
          onChange={(v) => setQuery((prev) => ({ ...prev, status: v, page: 1 }))}
          allowClear
          style={{ width: 130 }}
          options={[
            { label: '正常', value: 1 },
            { label: '已禁用', value: 0 },
          ]}
        />
        <div className="flex-1" />
        <Button icon={<PlusOutlined />} onClick={openCreate} className="btn-champagne !px-5">
          新增用户
        </Button>
      </div>

      {/* 玻璃面板 2：用户表格（不做 overflow-hidden 吞滚动条） */}
      <div className="glass-panel min-w-0">
        <div className="px-5 py-3 flex items-center justify-between border-b border-white/[0.08] bg-white/[0.03] text-[12.5px]">
          <span className="text-moon-light">
            共 <strong className="num text-white">{total}</strong> 个成员账号
          </span>
          <span className="text-moon-light/80">点击状态标签可快捷切换启用 / 禁用</span>
        </div>

        <div className="glass-table min-w-0">
          <Table<UserProfile>
            rowKey="id"
            dataSource={users}
            loading={loading}
            scroll={{ x: 960 }}
            pagination={{
              current: query.page,
              pageSize: query.pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: ['10', '20', '50', '100'],
              showTotal: (t) => <span className="text-moon-light">共 {t} 条</span>,
              onChange: (p, ps) =>
                setQuery((prev) => ({
                  ...prev,
                  page: ps !== prev.pageSize ? 1 : p,
                  pageSize: ps,
                })),
            }}
            columns={[
              {
                title: 'ID',
                dataIndex: 'id',
                width: 64,
                render: (v: number) => <span className="num text-moon-light">{v}</span>,
              },
              {
                title: '用户名',
                dataIndex: 'username',
                width: 150,
                render: (v: string, r: UserProfile) => (
                  <div className="flex items-center gap-2">
                    <span className="num font-medium text-white">{v}</span>
                    {r.id === currentUser?.id && (
                      <Tag
                        className="!m-0 !text-[11px]"
                        style={{
                          color: '#e4b863',
                          backgroundColor: 'rgba(228, 184, 99, 0.14)',
                          borderColor: 'rgba(228, 184, 99, 0.35)',
                        }}
                      >
                        当前账号
                      </Tag>
                    )}
                  </div>
                ),
              },
              {
                title: '昵称',
                dataIndex: 'nickname',
                width: 120,
                render: (v: string | null) => v || <span className="text-moon-light/50">-</span>,
              },
              {
                title: '邮箱',
                dataIndex: 'email',
                ellipsis: { showTitle: true },
                render: (v: string | null) =>
                  v ? (
                    <span className="block text-[13px] text-white/80 truncate">{v}</span>
                  ) : (
                    <span className="text-moon-light/50">-</span>
                  ),
              },
              {
                title: '角色',
                dataIndex: 'role',
                width: 130,
                render: (role: string, r: UserProfile) => {
                  const isSelf = r.id === currentUser?.id;
                  const selectEl = (
                    <Select
                      value={role}
                      size="small"
                      style={{ width: 104 }}
                      disabled={isSelf}
                      onChange={(v) => updateRole(r.id, v)}
                      options={ROLE_OPTIONS}
                    />
                  );
                  return isSelf ? (
                    <Tooltip title="不可修改当前登录账号的角色">{selectEl}</Tooltip>
                  ) : (
                    selectEl
                  );
                },
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 96,
                render: (s: number, r: UserProfile) => {
                  const isSelf = r.id === currentUser?.id;
                  if (s === 1) {
                    return isSelf ? (
                      <Tooltip title="不能禁用当前登录账号">
                        <Tag
                          className="!m-0"
                          style={{
                            background: 'rgba(52, 211, 153, 0.12)',
                            color: '#34d399',
                            borderColor: 'rgba(52, 211, 153, 0.32)',
                            cursor: 'not-allowed',
                          }}
                        >
                          正常
                        </Tag>
                      </Tooltip>
                    ) : (
                      <Tag
                        className="!m-0 cursor-pointer"
                        style={{
                          background: 'rgba(52, 211, 153, 0.12)',
                          color: '#34d399',
                          borderColor: 'rgba(52, 211, 153, 0.32)',
                        }}
                        onClick={() => toggleStatus(r.id, 0)}
                      >
                        正常
                      </Tag>
                    );
                  }
                  return (
                    <Tag
                      className="!m-0 cursor-pointer"
                      style={{
                        background: 'rgba(248, 113, 113, 0.12)',
                        color: '#f87171',
                        borderColor: 'rgba(248, 113, 113, 0.35)',
                      }}
                      onClick={() => toggleStatus(r.id, 1)}
                    >
                      已禁用
                    </Tag>
                  );
                },
              },
              {
                title: '注册时间',
                dataIndex: 'created_at',
                width: 155,
                render: (d: string) => (
                  <span className="num text-[12px] text-moon-light whitespace-nowrap">
                    {d ? new Date(d).toLocaleString() : '-'}
                  </span>
                ),
              },
              {
                title: '操作',
                key: 'actions',
                width: 245,
                fixed: 'right',
                render: (_: any, r: UserProfile) => {
                  const isSelf = r.id === currentUser?.id;
                  return (
                    <Space size={2} className="whitespace-nowrap">
                      <Button
                        type="link"
                        size="small"
                        className="!px-1.5"
                        icon={<EditOutlined />}
                        onClick={() => openEdit(r)}
                      >
                        编辑
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        className="!px-1.5"
                        icon={<KeyOutlined />}
                        onClick={() => openResetPassword(r)}
                      >
                        重置密码
                      </Button>
                      {isSelf ? (
                        <Tooltip title="不能删除当前登录账号">
                          <Button
                            type="link"
                            danger
                            size="small"
                            className="!px-1.5"
                            icon={<DeleteOutlined />}
                            disabled
                          >
                            删除
                          </Button>
                        </Tooltip>
                      ) : (
                        <Popconfirm
                          title="确认永久删除该用户？"
                          description="此操作不可撤销，将同时清理该用户的全部问答记录"
                          onConfirm={() => deleteUser(r.id)}
                          okText="确认删除"
                          okType="danger"
                          cancelText="取消"
                        >
                          <Button
                            type="link"
                            danger
                            size="small"
                            className="!px-1.5"
                            icon={<DeleteOutlined />}
                          >
                            删除
                          </Button>
                        </Popconfirm>
                      )}
                    </Space>
                  );
                },
              },
            ]}
          />
        </div>
      </div>

      {/* 新增 / 编辑用户弹窗 */}
      <Modal
        title={
          <span className="text-white">
            {modalType === 'create' ? '新增成员账号' : '编辑成员资料'}
          </span>
        }
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={submitting}
        okText={modalType === 'create' ? '创建账号' : '保存修改'}
        okButtonProps={{ className: 'btn-champagne !px-5' }}
        cancelButtonProps={{ className: 'btn-glass' }}
      >
        <Form form={form} layout="vertical" className="mt-3">
          {modalType === 'create' && (
            <Form.Item
              label="用户名"
              name="username"
              rules={[
                { required: true, message: '请输入用户名' },
                { min: 3, message: '用户名至少 3 个字符' },
              ]}
            >
              <Input placeholder="用于登录的唯一账号" />
            </Form.Item>
          )}
          <Form.Item label="昵称" name="nickname">
            <Input placeholder="界面展示名称" />
          </Form.Item>
          <Form.Item label="邮箱" name="email">
            <Input placeholder="name@company.com" />
          </Form.Item>
          {modalType === 'create' && (
            <>
              <Form.Item
                label="初始密码"
                name="password"
                rules={[{ min: 6, message: '密码至少 6 位' }]}
              >
                <Input.Password placeholder="留空则使用默认密码 123456" />
              </Form.Item>
              <Form.Item label="角色" name="role" initialValue="user">
                <Select options={ROLE_OPTIONS} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

      {/* 重置密码弹窗 */}
      <Modal
        title={<span className="text-white">重置密码 · {resetTarget?.username || ''}</span>}
        open={resetModalOpen}
        onCancel={() => setResetModalOpen(false)}
        onOk={handleResetPassword}
        confirmLoading={resetting}
        okText="确认重置"
        okButtonProps={{ className: 'btn-champagne !px-5' }}
        cancelButtonProps={{ className: 'btn-glass' }}
      >
        <Form form={resetForm} layout="vertical" className="mt-3">
          <Form.Item
            label="新密码"
            name="new_password"
            rules={[{ required: true, min: 6, message: '新密码至少 6 位' }]}
          >
            <Input.Password placeholder="请输入至少 6 位的新密码" />
          </Form.Item>
          <Form.Item
            label="确认新密码"
            name="confirm_password"
            dependencies={['new_password']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="再次输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
