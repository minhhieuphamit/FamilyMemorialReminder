import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router';
import { Layout, SettingsMenu } from './components/Layout';
import { Empty, ErrorBox, Loading, ToastProvider } from './components/ui';
import './index.css';
import type { AuthInfo } from '../../src/types/domain';
import { api, AUTH_EXPIRED_EVENT } from './lib/api';
import { AuthContext } from './lib/auth';
import { Register } from './pages/Register';
import { Account } from './pages/Account';
import { Backup } from './pages/Backup';
import { CalendarPage } from './pages/CalendarPage';
import { ChannelSettings } from './pages/ChannelSettings';
import { Dashboard } from './pages/Dashboard';
import { EventForm } from './pages/EventForm';
import { EventList } from './pages/EventList';
import { Families } from './pages/Families';
import { Login } from './pages/Login';
import { NotificationHistory } from './pages/NotificationHistory';
import { ReminderSettings } from './pages/ReminderSettings';

function App() {
  const location = useLocation();
  // undefined: đang kiểm tra, null: chưa đăng nhập.
  const [auth, setAuth] = useState<AuthInfo | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const check = () => {
    setError(null);
    api<{ authenticated: boolean } & Partial<AuthInfo>>('/auth/me')
      .then((r) => setAuth(r.authenticated ? (r as unknown as AuthInfo) : null))
      .catch((err: Error) => setError(err.message));
  };

  useEffect(() => {
    check();
    const onExpired = () => setAuth(null);
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  async function logout() {
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    setAuth(null);
  }

  if (location.pathname === '/dang-ky') return <Register />;
  if (error) {
    return (
      <div className="p-4">
        <ErrorBox message={error} onRetry={check} />
      </div>
    );
  }
  if (auth === undefined) return <Loading />;
  if (!auth) return <><Login onSuccess={check} /><p className="pb-8 text-center"><Link className="underline" to="/dang-ky">Đăng ký nhận tin theo gia đình</Link></p></>;

  // key: đổi tài khoản thì dựng lại toàn bộ trang, không giữ dữ liệu của tài khoản trước.
  const accountKey = auth.role === 'family' ? `family-${auth.familyId}` : 'admin';
  return (
    <AuthContext.Provider value={auth}>
    <Routes key={accountKey}>
      <Route element={<Layout onLogout={logout} />}>
        <Route index element={<Dashboard />} />
        <Route path="ngay-gio" element={<EventList />} />
        <Route path="ngay-gio/them" element={<EventForm key="new" />} />
        <Route path="ngay-gio/:id" element={<EventForm key="edit" />} />
        <Route path="lich" element={<CalendarPage />} />
        <Route path="gia-dinh" element={auth.role === 'admin' ? <Families /> : <Empty title="Trang này chỉ dành cho quản trị viên" />} />
        <Route path="tai-khoan" element={<Account />} />
        <Route path="kenh-gui" element={<ChannelSettings />} />
        <Route path="nhac-nho" element={<ReminderSettings />} />
        <Route path="lich-su" element={<NotificationHistory />} />
        <Route path="sao-luu" element={<Backup />} />
        <Route path="cai-dat" element={<SettingsMenu onLogout={logout} />} />
        <Route
          path="*"
          element={
            <Empty title="Không tìm thấy trang">
              <Link to="/" className="underline">
                Về trang tổng quan
              </Link>
            </Empty>
          }
        />
      </Route>
    </Routes>
    </AuthContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
