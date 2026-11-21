import { useEffect, useState } from 'react';
import { Form, Input, Button, message, Avatar } from 'antd';
import { UserOutlined, MailOutlined, LockOutlined } from '@ant-design/icons';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { getRoleLabel, ROLE_META, type UserProfile } from '../types';

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-white/[0.08] last:border-0">
      <span className="text-[13px] text-moon-light shrink-0">{label}</span>
      <span className="text-[13.5px] text-white text-right break-all">{value}</span>
    </div>
  );
}

export default function Profile() {
  const { updateUser } = useAuth();
  const [profileForm] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const loadProfile = async () => {
    try {
      const res: any = await api.get('/user/profile');
      if (res?.code === 200 && res?.data) {
        setProfile(res.data);
        profileForm.setFieldsValue({
          nickname: res.data.nickname || '',
          email: res.data.email || '',
          avatar: res.data.avatar || '',
        });
      }
    } catch {
      /* 拦截器处理 */
    }
  };

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpdateProfile = async (values: {
    nickname?: string;
    email?: string;
    avatar?: string;
  }) => {
    setSavingProfile(true);
    try {
      const res: any = await api.put('/user/profile', values);
      if (res?.code === 200 && res?.data) {
        message.success('个人资料已更新');
        setProfile(res.data);
        updateUser({
          nickname: res.data.nickname,
          email: res.data.email,
          avatar: res.data.avatar,
        });
      }
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (values: {
    old_password: string;
    new_password: string;
  }) => {
    setSavingPassword(true);
    try {
      await api.put('/user/change-password', values);
      message.success('密码修改成功');
      passwordForm.resetFields();
    } catch {
      /* 拦截器处理 */
    } finally {
      setSavingPassword(false);
    }
  };

  const roleLabel = getRoleLabel(profile?.role);
  const roleStyle = ROLE_META[profile?.role || 'user'] ?? ROLE_META.user;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* 玻璃面板 1：个人名片与账号概览 */}
      <div className="glass-panel p-6 grid grid-cols-1 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] gap-6 items-center">
        <div className="glass-tile p-6 flex flex-col items-center justify-center text-center">
          <Avatar
            size={72}
            src={profile?.avatar || undefined}
            className="!bg-white/10 !text-champagne border border-champagne/40 text-[24px] font-semibold"
            icon={!profile?.avatar ? <UserOutlined /> : undefined}
          />
          <h3 className="mt-4 text-[18px] font-semibold text-white">
            {profile?.nickname || profile?.username || '未登录'}
          </h3>
          <p className="mt-1 text-[13px] text-moon-light">{profile?.email || '暂未绑定邮箱'}</p>
          <div className="mt-3">
            <span
              className="inline-block px-3 py-1 text-[12px] font-medium rounded-full border"
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

        <div>
          <h3 className="text-[15px] font-semibold text-white pb-3 border-b border-white/10">
            账号信息
          </h3>
          <div className="mt-1">
            <InfoRow
              label="登录用户名"
              value={<span className="num font-medium">{profile?.username || '-'}</span>}
            />
            <InfoRow label="系统角色" value={roleLabel} />
            <InfoRow
              label="账号状态"
              value={
                <span
                  className={
                    profile?.status === 1 ? 'text-ok font-medium' : 'text-danger font-medium'
                  }
                >
                  {profile?.status === 1 ? '正常启用' : '已禁用'}
                </span>
              }
            />
            <InfoRow
              label="用户编号"
              value={<span className="num text-moon-light">{profile?.id ?? '-'}</span>}
            />
            <InfoRow
              label="注册时间"
              value={
                <span className="num text-[12.5px] text-moon-light">
                  {profile?.created_at ? new Date(profile.created_at).toLocaleString() : '-'}
                </span>
              }
            />
          </div>
        </div>
      </div>

      {/* 玻璃面板 2：编辑资料（唯一香槟金主 CTA） */}
      <div className="glass-panel p-6">
        <div className="pb-3 mb-4 border-b border-white/10">
          <h3 className="text-[15px] font-semibold text-white">基本资料</h3>
          <p className="mt-0.5 text-[12.5px] text-moon-light">
            修改您的展示昵称、联系邮箱与头像地址
          </p>
        </div>
        <Form
          form={profileForm}
          onFinish={handleUpdateProfile}
          layout="vertical"
          className="max-w-xl"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <Form.Item label="昵称" name="nickname">
              <Input
                prefix={<UserOutlined className="text-moon-light" />}
                placeholder="请输入昵称"
              />
            </Form.Item>
            <Form.Item label="邮箱" name="email">
              <Input
                prefix={<MailOutlined className="text-moon-light" />}
                placeholder="name@company.com"
              />
            </Form.Item>
          </div>
          <Form.Item label="头像链接" name="avatar">
            <Input placeholder="https://example.com/avatar.png（可选）" />
          </Form.Item>
          <Button htmlType="submit" loading={savingProfile} className="btn-champagne !px-6">
            保存修改
          </Button>
        </Form>
      </div>

      {/* 玻璃面板 3：修改密码 */}
      <div className="glass-panel p-6">
        <div className="pb-3 mb-4 border-b border-white/10">
          <h3 className="text-[15px] font-semibold text-white">账号安全</h3>
          <p className="mt-0.5 text-[12.5px] text-moon-light">定期更新密码有助于保障账号安全</p>
        </div>
        <Form
          form={passwordForm}
          onFinish={handleChangePassword}
          layout="vertical"
          className="max-w-xl"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <Form.Item
              label="原密码"
              name="old_password"
              rules={[{ required: true, message: '请输入原密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined className="text-moon-light" />}
                placeholder="请输入原密码"
              />
            </Form.Item>
            <Form.Item
              label="新密码"
              name="new_password"
              rules={[{ required: true, min: 6, message: '新密码至少 6 位' }]}
            >
              <Input.Password
                prefix={<LockOutlined className="text-moon-light" />}
                placeholder="至少 6 位新密码"
              />
            </Form.Item>
          </div>
          <Button
            danger
            htmlType="submit"
            loading={savingPassword}
            className="!rounded-btn !bg-danger/10 !border-danger/40 !text-danger hover:!bg-danger/20"
          >
            更新密码
          </Button>
        </Form>
      </div>
    </div>
  );
}
