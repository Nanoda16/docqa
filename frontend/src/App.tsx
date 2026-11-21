import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { AuthProvider, useAuth } from './context/AuthContext';
import AppLayout from './components/Layout';
import Login from './pages/Login';
import Chat from './pages/Chat';
import Documents from './pages/Documents';
import Profile from './pages/Profile';
import Admin from './pages/Admin';
import UserManagement from './pages/UserManagement';

const FONT_SANS =
  "'Inter', 'SF Pro Display', 'PingFang SC', 'HarmonyOS Sans SC', 'Source Han Sans SC', " +
  "'Noto Sans SC', 'Microsoft YaHei UI', system-ui, -apple-system, sans-serif";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return user?.role === 'admin' ? <>{children}</> : <Navigate to="/chat" replace />;
}

function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#e4b863',
          colorPrimaryHover: '#ecc57a',
          colorInfo: '#7c9cc4',
          colorSuccess: '#34d399',
          colorWarning: '#fbbf24',
          colorError: '#f87171',
          colorText: '#ffffff',
          colorTextSecondary: '#7c9cc4',
          colorTextTertiary: 'rgba(124, 156, 196, 0.72)',
          colorTextQuaternary: 'rgba(124, 156, 196, 0.45)',
          colorBgBase: '#0b1322',
          colorBgContainer: 'rgba(255, 255, 255, 0.05)',
          colorBgElevated: 'rgba(11, 19, 34, 0.92)',
          colorBgLayout: 'transparent',
          colorBorder: 'rgba(255, 255, 255, 0.15)',
          colorBorderSecondary: 'rgba(255, 255, 255, 0.08)',
          colorFillAlter: 'rgba(255, 255, 255, 0.04)',
          borderRadius: 16,
          borderRadiusLG: 24,
          borderRadiusSM: 12,
          fontFamily: FONT_SANS,
          fontSize: 14,
          controlHeight: 38,
          lineWidth: 1,
          wireframe: false,
        },
        components: {
          Layout: {
            bodyBg: 'transparent',
            headerBg: 'transparent',
            siderBg: 'transparent',
          },
          Table: {
            headerBg: 'rgba(255, 255, 255, 0.05)',
            headerColor: '#7c9cc4',
            headerSplitColor: 'transparent',
            borderColor: 'rgba(255, 255, 255, 0.08)',
            rowHoverBg: 'rgba(255, 255, 255, 0.06)',
            cellPaddingBlock: 12,
            headerBorderRadius: 16,
          },
          Input: {
            activeBorderColor: 'rgba(255, 255, 255, 0.40)',
            hoverBorderColor: 'rgba(255, 255, 255, 0.28)',
            activeShadow: '0 0 0 3px rgba(255, 255, 255, 0.08)',
            borderRadius: 14,
          },
          Select: {
            activeBorderColor: 'rgba(255, 255, 255, 0.40)',
            hoverBorderColor: 'rgba(255, 255, 255, 0.28)',
            borderRadius: 14,
          },
          Button: {
            defaultShadow: 'none',
            primaryShadow: 'none',
            dangerShadow: 'none',
            fontWeight: 500,
            borderRadius: 16,
          },
          Tabs: {
            inkBarColor: '#e4b863',
            itemSelectedColor: '#ffffff',
            itemColor: '#7c9cc4',
            itemHoverColor: '#ffffff',
            titleFontSize: 14,
          },
          Modal: {
            contentBg: 'rgba(11, 19, 34, 0.88)',
            headerBg: 'transparent',
          },
          Drawer: {
            colorBgElevated: 'rgba(11, 19, 34, 0.90)',
          },
          Empty: {
            colorTextDescription: '#7c9cc4',
          },
        },
      }}
    >
      {/* 全局固定夜景柔光斑层（为全站玻璃提供光学折射基底） */}
      <div className="night-backdrop" aria-hidden>
        <div className="night-orb night-orb-steel-top" />
        <div className="night-orb night-orb-champagne" />
        <div className="night-orb night-orb-steel-bottom" />
      </div>

      <div className="relative z-10 min-h-screen">
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="chat" element={<Chat />} />
                <Route path="documents" element={<Documents />} />
                <Route path="profile" element={<Profile />} />
                <Route
                  path="admin"
                  element={
                    <AdminRoute>
                      <Admin />
                    </AdminRoute>
                  }
                />
                <Route
                  path="users"
                  element={
                    <AdminRoute>
                      <UserManagement />
                    </AdminRoute>
                  }
                />
                <Route path="" element={<Navigate to="/chat" replace />} />
                <Route path="*" element={<Navigate to="/chat" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </div>
    </ConfigProvider>
  );
}

export default App;
