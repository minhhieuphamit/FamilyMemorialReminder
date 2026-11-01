import { Link } from 'react-router';
import type { DashboardData } from '../../../src/types/domain';
import { formatDateVN, parseISODate, weekdayLabel } from '../../../src/utils/dates';
import { lunarYearName, solarToLunar } from '../../../src/utils/lunar-calendar';
import { OccurrenceRow, UnresolvedRow } from '../components/EventRow';
import { Empty, ErrorBox, Loading, Notice, PageHeader, StatusDot } from '../components/ui';
import { useApi } from '../lib/api';
import { useAuth } from '../lib/auth';

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${highlight ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}>
      <p className={`text-3xl font-semibold tabular-nums ${highlight ? 'text-accent' : ''}`}>{value}</p>
      <p className="mt-1 text-sm text-muted">{label}</p>
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' });
}

export function Dashboard() {
  const { isAdmin } = useAuth();
  const { data, error, loading, reload } = useApi<DashboardData>('/dashboard');
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? 'Không tải được dữ liệu'} onRetry={reload} />;

  const lunar = solarToLunar(parseISODate(data.today));
  const channelsReady = data.channelsConfigured.length > 0 && data.activeChats > 0;
  const channelNames = data.channelsConfigured.map((c) => (c === 'telegram' ? 'Telegram' : 'Zalo')).join(', ');

  return (
    <>
      <PageHeader
        title="Tổng quan"
        subtitle={`${weekdayLabel(data.today)}, ${formatDateVN(data.today)} · ${lunar.day}/${lunar.month}${lunar.isLeap ? ' nhuận' : ''} năm ${lunarYearName(lunar.year)}`}
      />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Hôm nay" value={data.counts.today} highlight={data.counts.today > 0} />
        <Stat label="Trong tháng" value={data.counts.thisMonth} />
        <Stat label="Sắp tới" value={data.counts.upcoming} />
      </div>

      {data.todayItems.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">Hôm nay</h2>
          <div className="card divide-y divide-line overflow-hidden">
            {data.todayItems.map((item) => (
              <OccurrenceRow key={`${item.eventId}-${item.occurrence.solarDate}`} item={item} />
            ))}
          </div>
        </section>
      )}

      {data.unresolved.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold text-warn">Cần xử lý ({data.unresolved.length})</h2>
          <div className="card divide-y divide-line overflow-hidden">
            {data.unresolved.map((u) => (
              <UnresolvedRow key={`${u.eventId}-${u.unresolved.lunarYear}`} {...u} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-2 font-semibold">Sắp tới</h2>
        {data.upcoming.length > 0 ? (
          <div className="card divide-y divide-line overflow-hidden">
            {data.upcoming.map((item) => (
              <OccurrenceRow key={`${item.eventId}-${item.occurrence.solarDate}`} item={item} />
            ))}
          </div>
        ) : data.counts.total === 0 ? (
          <Empty title="Chưa có ngày giỗ nào">
            <Link to="/ngay-gio/them" className="btn btn-primary mt-2">
              Thêm ngày giỗ đầu tiên
            </Link>
          </Empty>
        ) : (
          <Empty title="Không có ngày giỗ nào trong thời gian tới" />
        )}
      </section>

      <section className="mt-6 grid gap-3 md:grid-cols-2">
        <Link to="/kenh-gui" className="card block p-4 hover:bg-subtle">
          <p className="mb-2 text-sm text-muted">Kênh gửi{channelNames ? `: ${channelNames}` : ''}</p>
          <StatusDot
            ok={channelsReady}
            label={data.channelsConfigured.length === 0 ? 'Chưa cấu hình bot' : data.activeChats === 0 ? 'Chưa có Chat ID nhận tin' : `${data.activeChats} Chat ID nhận thông báo`}
          />
        </Link>
        {isAdmin && <Link to="/lich-su" className="card block p-4 hover:bg-subtle">
          <p className="mb-2 text-sm text-muted">Lần chạy tự động gần nhất</p>
          {data.lastCron ? (
            <StatusDot
              ok={data.lastCron.failed === 0}
              label={`${formatDateTime(data.lastCron.ranAt)}: gửi ${data.lastCron.sent}, lỗi ${data.lastCron.failed}`}
            />
          ) : (
            <StatusDot ok={null} label="Chưa chạy lần nào" />
          )}
        </Link>}
      </section>

      {data.lastCron?.note && (
        <div className="mt-3">
          <Notice tone="info">Ghi chú lần chạy gần nhất: {data.lastCron.note}</Notice>
        </div>
      )}
    </>
  );
}
