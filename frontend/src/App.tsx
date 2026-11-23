import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import AppLayout from './components/Layout';
import Login from './pages/Login';
import Home from './pages/Home';
import Chat from './pages/Chat';
import Documents from './pages/Documents';
import Profile from './pages/Profile';
import ConsoleHub from './pages/ConsoleHub';
import Admin from './pages/Admin';
import UserManagement from './pages/UserManagement';

const FONT_SANS =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Inter', " +
  "'PingFang SC', 'HarmonyOS Sans SC', 'Source Han Sans SC', 'Noto Sans SC', " +
  "'Microsoft YaHei UI', system-ui, sans-serif";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return user?.role === 'admin' ? <>{children}</> : <Navigate to="/" replace />;
}

function ThemedApp() {
  const { isDark } = useTheme();

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: isDark ? '#f5f5f7' : '#1d1d1f',
          colorPrimaryHover: isDark ? '#e5e5ea' : '#3a3a3c',
          colorInfo: isDark ? '#a1a1a6' : '#6e6e73',
          colorSuccess: isDark ? '#4ade80' : '#15803d',
          colorWarning: isDark ? '#fbbf24' : '#b45309',
          colorError: isDark ? '#f87171' : '#b91c1c',
          colorText: isDark ? '#f5f5f7' : '#1d1d1f',
          colorTextSecondary: isDark ? '#a1a1a6' : '#6e6e73',
          colorTextTertiary: isDark ? '#6e6e73' : '#86868b',
          colorBgBase: isDark ? '#000000' : '#ffffff',
          colorBgContainer: isDark ? '#1c1c1e' : '#ffffff',
          colorBgElevated: isDark ? '#1c1c1e' : '#ffffff',
          colorBgLayout: isDark ? '#000000' : '#ffffff',
          colorBorder: isDark ? 'rgba(245, 245, 247, 0.14)' : 'rgba(29, 29, 31, 0.12)',
          colorBorderSecondary: isDark
            ? 'rgba(245, 245, 247, 0.08)'
            : 'rgba(29, 29, 31, 0.08)',
          borderRadius: 12,
          borderRadiusLG: 18,
          borderRadiusSM: 8,
          fontFamily: FONT_SANS,
          fontSize: 14,
          controlHeight: 38,
          lineWidth: 1,
          wireframe: false,
        },
        components: {
          Button: {
            defaultShadow: 'none',
            primaryShadow: 'none',
            dangerShadow: 'none',
            primaryColor: isDark ? '#1d1d1f' : '#ffffff',
            fontWeight: 500,
            borderRadius: 999,
          },
          Input: {
            borderRadius: 12,
          },
          Select: {
            borderRadius: 12,
          },
          Table: {
            headerBg: isDark ? '#161617' : '#f5f5f7',
            headerColor: isDark ? '#a1a1a6' : '#6e6e73',
            headerSplitColor: 'transparent',
            rowHoverBg: isDark ? '#161617' : '#f5f5f7',
            cellPaddingBlock: 12,
          },
          Modal: {
            contentBg: isDark ? '#1c1c1e' : '#ffffff',
            headerBg: isDark ? '#1c1c1e' : '#ffffff',
          },
          Drawer: {
            colorBgElevated: isDark ? '#161617' : '#ffffff',
          },
          Tabs: {
            inkBarColor: isDark ? '#f5f5f7' : '#1d1d1f',
            itemSelectedColor: isDark ? '#f5f5f7' : '#1d1d1f',
            itemHoverColor: isDark ? '#f5f5f7' : '#1d1d1f',
          },
        },
      }}
    >
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Home />} />
              <Route path="chat" element={<Chat />} />

              {/* 知识库二级域与三级子视图 */}
              <Route path="knowledge" element={<Navigate to="/knowledge/list" replace />} />
              <Route path="knowledge/list" element={<Documents />} />
              <Route path="knowledge/upload" element={<Documents />} />

              {/* 管理员控制台二级域与三级子页面 */}
              <Route
                path="console"
                element={
                  <AdminRoute>
                    <ConsoleHub />
                  </AdminRoute>
                }
              />
              <Route
                path="console/cache"
                element={
                  <AdminRoute>
                    <Admin />
                  </AdminRoute>
                }
              />
              <Route
                path="console/users"
                element={
                  <AdminRoute>
                    <UserManagement />
                  </AdminRoute>
                }
              />

              {/* 账号域 */}
              <Route path="account/profile" element={<Profile />} />

              {/* 旧路径兼容重定向 */}
              <Route path="documents" element={<Navigate to="/knowledge/list" replace />} />
              <Route path="admin" element={<Navigate to="/console/cache" replace />} />
              <Route path="users" element={<Navigate to="/console/users" replace />} />
              <Route path="profile" element={<Navigate to="/account/profile" replace />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ConfigProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  );
}

export default App;
