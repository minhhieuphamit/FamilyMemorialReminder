import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useAuth } from '../lib/auth';

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  home: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  plus: 'M12 5v14M5 12h14',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  family: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a7 7 0 0114 0v1M16 3.500a4 4 0 010 7M22 21v-1a7 7 0 00-4-6.300',
  account: 'M12 12a4 4 0 100-8 4 4 0 000 8zM5 21a7 7 0 0114 0',
  send: 'M21 3L10 14M21 3l-7 18-4-7-7-4z',
  bell: 'M18 9a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8M10 21h4',
  history: 'M12 7v5l3 2M3 12a9 9 0 109-9 9 9 0 00-7 3.300M3 4v4h4',
  backup: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  settings: 'M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4M16 4v4M8 10v4M14 16v4',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M6 6L4.500 4.500M19.500 19.500L18 18M18 6l1.500-1.500M4.500 19.500L6 18M12 8a4 4 0 100 8 4 4 0 000-8z',
  moon: 'M20 14.500A8.500 8.500 0 019.500 4 8.500 8.500 0 1020 14.500z',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
};

const NAV = [
  { to: '/', label: 'Tổng quan', icon: ICONS.home, end: true },
  { to: '/ngay-gio', label: 'Ngày giỗ', icon: ICONS.list, end: true },
  { to: '/ngay-gio/them', label: 'Thêm ngày giỗ', icon: ICONS.plus, end: true },
  { to: '/lich', label: 'Lịch tháng', icon: ICONS.calendar, end: true },
  { to: '/gia-dinh', label: 'Gia đình', icon: ICONS.family, end: true },
  { to: '/kenh-gui', label: 'Kênh gửi', icon: ICONS.send, end: true },
  { to: '/nhac-nho', label: 'Nhắc nhở', icon: ICONS.bell, end: true },
  { to: '/lich-su', label: 'Lịch sử gửi', icon: ICONS.history, end: true },
  { to: '/sao-luu', label: 'Sao lưu', icon: ICONS.backup, end: true },
  { to: '/tai-khoan', label: 'Tài khoản', icon: ICONS.account, end: true },
];

const MOBILE_NAV = [
  { to: '/', label: 'Tổng quan', icon: ICONS.home, end: true },
  { to: '/ngay-gio', label: 'Ngày giỗ', icon: ICONS.list, end: true },
  { to: '/ngay-gio/them', label: 'Thêm', icon: ICONS.plus, end: true },
  { to: '/lich', label: 'Lịch', icon: ICONS.calendar, end: true },
  { to: '/cai-dat', label: 'Cài đặt', icon: ICONS.settings, end: true },
];

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      // Trình duyệt chặn lưu trữ: giao diện vẫn đổi trong phiên hiện tại.
    }
    setDark(next);
  };
  return { dark, toggle };
}

function SideButton({ onClick, icon, children }: { onClick: () => void; icon: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-subtle hover:text-ink">
      <Icon d={icon} />
      {children}
    </button>
  );
}

export function Layout({ onLogout }: { onLogout: () => void }) {
  const { dark, toggle } = useTheme();
  const { isAdmin, familyName } = useAuth();
  const nav = NAV.filter((item) => isAdmin || item.to !== '/gia-dinh');

  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line px-3 py-5 md:flex">
        <Link to="/" className="mb-6 flex items-center gap-2.5 px-3 font-semibold">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="min-w-0 truncate">
            {familyName ?? 'Ngày giỗ gia đình'}
            {familyName && <span className="block text-xs font-normal text-muted">Ngày giỗ gia đình</span>}
          </span>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${
                  isActive ? 'bg-accent-soft font-semibold text-accent' : 'text-muted hover:bg-subtle hover:text-ink'
                }`
              }
            >
              <Icon d={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <SideButton onClick={toggle} icon={dark ? ICONS.sun : ICONS.moon}>
          {dark ? 'Giao diện sáng' : 'Giao diện tối'}
        </SideButton>
        <SideButton onClick={onLogout} icon={ICONS.logout}>
          Đăng xuất
        </SideButton>
      </aside>

      <main className="min-w-0 flex-1 px-4 pt-5 pb-28 md:px-8 md:pt-8 md:pb-10">
        <div className="mx-auto max-w-4xl">
          <Outlet />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {MOBILE_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 py-2 text-[11px] ${isActive ? 'font-semibold text-accent' : 'text-muted'}`
            }
          >
            <Icon d={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/** Trang cài đặt trên điện thoại: gom các mục không có chỗ trên thanh điều hướng dưới. */
export function SettingsMenu({ onLogout }: { onLogout: () => void }) {
  const { dark, toggle } = useTheme();
  const { isAdmin, familyName } = useAuth();
  const links = NAV.filter((n) => [...(isAdmin ? ['/gia-dinh'] : []), '/kenh-gui', '/nhac-nho', '/lich-su', '/sao-luu', '/tai-khoan'].includes(n.to));
  const row = 'flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left text-sm';
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Cài đặt</h1>
      <p className="mt-1 mb-5 text-sm text-muted">{familyName ?? 'Quản trị viên'}</p>
      <div className="card divide-y divide-line overflow-hidden">
        {links.map((item) => (
          <Link key={item.to} to={item.to} className={row}>
            <Icon d={item.icon} />
            {item.label}
          </Link>
        ))}
        <button type="button" className={row} onClick={toggle}>
          <Icon d={dark ? ICONS.sun : ICONS.moon} />
          {dark ? 'Giao diện sáng' : 'Giao diện tối'}
        </button>
        <button type="button" className={`${row} text-danger`} onClick={onLogout}>
          <Icon d={ICONS.logout} />
          Đăng xuất
        </button>
      </div>
    </>
  );
}
