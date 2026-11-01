import { useEffect, useState } from 'react';
import type { NotificationLog, NotificationStatus } from '../../../src/types/domain';
import { formatDateVN } from '../../../src/utils/dates';
import { Empty, ErrorBox, Loading, PageHeader } from '../components/ui';
import { Pagination } from '../components/Pagination';
import { useApi } from '../lib/api';

const STATUS_LABELS: Record<NotificationStatus, { label: string; tone: string }> = {
  sent: { label: 'Đã gửi', tone: 'bg-ok-soft text-ok' },
  failed: { label: 'Thất bại', tone: 'bg-danger-soft text-danger' },
  pending: { label: 'Đang chờ', tone: 'bg-subtle text-muted' },
  sending: { label: 'Đang gửi', tone: 'bg-warn-soft text-warn' },
};

function describeLog(log: NotificationLog): string {
  if (log.kind === 'test') return 'Gửi từ website';
  const when = log.daysBefore === 0 ? 'đúng ngày' : `trước ${log.daysBefore} ngày`;
  return `Giỗ ${formatDateVN(log.occurrenceDate ?? log.scheduledDate)}, nhắc ${when}`;
}

export function NotificationHistory() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState('');
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) query.set('status', status);
  const { data, error, loading, reload } = useApi<{ logs: NotificationLog[]; total: number; pageSize: number }>(`/notifications/logs?${query}`);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  useEffect(() => { if (data && !loading && page > totalPages) setPage(totalPages); }, [data, loading, page, totalPages]);

  return (
    <>
      <PageHeader
        title="Lịch sử thông báo"
        subtitle={data ? `${data.total} lượt gửi` : undefined}
        action={
          <select
            className="input w-auto"
            aria-label="Lọc theo trạng thái"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Mọi trạng thái</option>
            <option value="sent">Đã gửi</option>
            <option value="failed">Thất bại</option>
          </select>
        }
      />

      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && data.logs.length === 0 && <Empty title="Chưa có thông báo nào">Lịch sử sẽ hiện ở đây sau lần gửi đầu tiên.</Empty>}
      {data && data.logs.length > 0 && (
        <div className="card divide-y divide-line overflow-hidden">
          {data.logs.map((log) => {
            const s = STATUS_LABELS[log.status];
            return (
              <div key={log.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate font-medium">{log.eventName}</p>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.tone}`}>{s.label}</span>
                </div>
                <p className="mt-0.5 text-sm text-muted">{describeLog(log)}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {log.channel === 'zalo' ? 'Zalo' : 'Telegram'} {log.chatId} ·{new Date(log.sentAt ?? log.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' })} · {log.attempts} lần thử
                </p>
                {log.errorMessage && <p className="mt-1 text-xs break-words text-danger">{log.errorMessage}</p>}
              </div>
            );
          })}
        </div>
      )}

      {data && <Pagination page={page} pageSize={pageSize} total={data.total} disabled={loading} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />}
    </>
  );
}
