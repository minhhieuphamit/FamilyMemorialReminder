import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { formatLunarLabel } from '../../../src/services/occurrences';
import type { EventView, Family, ItemDTO } from '../../../src/types/domain';
import { formatDateVN, parseISODate, weekdayLabel } from '../../../src/utils/dates';
import { normalizeVietnamese } from '../../../src/utils/text';
import { OccurrenceRow } from '../components/EventRow';
import { FamilyFilter } from '../components/FamilyFilter';
import { DaysBadge, Empty, ErrorBox, Loading, PageHeader } from '../components/ui';
import { useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { unresolvedReason } from '../lib/labels';

type View = 'list' | 'family' | 'month';

function EventCard({ event, showFamily = true }: { event: EventView; showFamily?: boolean }) {
  const { isAdmin } = useAuth();
  const lunarLabel = formatLunarLabel({ lunarDay: event.lunarDay, lunarMonth: event.lunarMonth, isLeapMonth: event.isLeapMonth });
  return (
    <Link to={`/ngay-gio/${event.id}`} className="block px-4 py-3.5 hover:bg-subtle">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{event.fullName}</p>
          <p className="mt-0.5 text-sm text-muted">
            {isAdmin && showFamily && event.familyName && `${event.familyName} · `}
            {event.relationship && `${event.relationship} · `}Giỗ {lunarLabel} âm
            {event.deathYear ? ` · Mất năm ${event.deathYear}` : ''}
          </p>
          <p className="mt-0.5 text-sm text-muted">
            {event.next
              ? `${weekdayLabel(event.next.solarDate)} ${formatDateVN(event.next.solarDate)}`
              : 'Chưa xác định được ngày dương'}
            {!event.reminderEnabled && ' · Đã tắt nhắc'}
          </p>
          {event.unresolved.map((u) => (
            <p key={u.lunarYear} className="mt-0.5 text-xs text-warn">
              {unresolvedReason(u)}
            </p>
          ))}
        </div>
        {event.next && <DaysBadge days={event.next.daysLeft} />}
      </div>
    </Link>
  );
}

function ListView({ q, sort, solarMonth, family, grouped }: { q: string; sort: string; solarMonth: string; family: string; grouped: boolean }) {
  const params = new URLSearchParams({ sort });
  if (q) params.set('q', q);
  if (solarMonth) params.set('solarMonth', solarMonth);
  if (family) params.set('family', family);
  const { data, error, loading, reload } = useApi<{ events: EventView[] }>(`/events?${params}`);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? 'Không tải được dữ liệu'} onRetry={reload} />;
  if (data.events.length === 0) {
    return q || solarMonth || family ? (
      <Empty title="Không có kết quả phù hợp">Thử từ khóa khác hoặc bỏ bộ lọc.</Empty>
    ) : (
      <Empty title="Chưa có ngày giỗ nào">
        <Link to="/ngay-gio/them" className="btn btn-primary mt-2">
          Thêm ngày giỗ đầu tiên
        </Link>
      </Empty>
    );
  }
  if (!grouped) {
    return (
      <div className="card divide-y divide-line overflow-hidden">
        {data.events.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>
    );
  }

  const groups = new Map<string, EventView[]>();
  for (const event of data.events) {
    const name = event.familyName ?? '';
    groups.set(name, [...(groups.get(name) ?? []), event]);
  }
  const names = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'vi')));
  return (
    <div className="space-y-5">
      {names.map((name) => (
        <section key={name}>
          <h2 className="mb-2 font-semibold">
            {name || 'Chưa xếp gia đình'} <span className="font-normal text-muted">({groups.get(name)!.length})</span>
          </h2>
          <div className="card divide-y divide-line overflow-hidden">
            {groups.get(name)!.map((event) => (
              <EventCard key={event.id} event={event} showFamily={false} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ByMonthView({ q, family }: { q: string; family: string }) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const { data, error, loading, reload } = useApi<{ items: ItemDTO[] }>(`/year?year=${year}${family ? `&family=${family}` : ''}`);

  const needle = normalizeVietnamese(q);
  const items = (data?.items ?? []).filter((i) => normalizeVietnamese(`${i.fullName} ${i.relationship} ${i.familyName ?? ''}`).includes(needle));
  const months = Array.from({ length: 12 }, (_, i) => i + 1)
    .map((month) => ({ month, items: items.filter((i) => parseISODate(i.occurrence.solarDate).month === month) }))
    .filter((m) => m.items.length > 0);

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <button type="button" className="btn btn-sm" aria-label="Năm trước" onClick={() => setYear(year - 1)}>
          ‹ {year - 1}
        </button>
        <span className="font-semibold">Năm {year}</span>
        <button type="button" className="btn btn-sm" aria-label="Năm sau" onClick={() => setYear(year + 1)}>
          {year + 1} ›
        </button>
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && months.length === 0 && <Empty title="Không có ngày giỗ trong năm này" />}
      <div className="space-y-5">
        {months.map((m) => (
          <section key={m.month}>
            <h2 className="mb-2 font-semibold">Tháng {m.month}</h2>
            <div className="card divide-y divide-line overflow-hidden">
              {m.items.map((item) => (
                <OccurrenceRow key={`${item.eventId}-${item.occurrence.solarDate}`} item={item} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

const VIEWS: [View, string][] = [
  ['list', 'Danh sách'],
  ['family', 'Theo gia đình'],
  ['month', 'Theo tháng'],
];

export function EventList() {
  const { isAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<View>('list');
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('next');
  const [solarMonth, setSolarMonth] = useState('');
  const [family, setFamily] = useState(searchParams.get('family') ?? '');
  const families = useApi<{ families: Family[] }>('/families');

  useEffect(() => {
    const timer = setTimeout(() => setQ(input.trim()), 250);
    return () => clearTimeout(timer);
  }, [input]);

  return (
    <>
      <PageHeader
        title="Danh sách ngày giỗ"
        action={
          <Link to="/ngay-gio/them" className="btn btn-primary">
            Thêm ngày giỗ
          </Link>
        }
      />

      <div className="mb-4 space-y-2">
        <input type="search" className="input" placeholder="Tìm tên, quan hệ, gia đình, ghi chú..." aria-label="Tìm kiếm" value={input} onChange={(e) => setInput(e.target.value)} />
        <div className="flex rounded-xl border border-line bg-surface p-0.5" role="group" aria-label="Kiểu xem">
          {VIEWS.filter(([value]) => isAdmin || value !== 'family').map(([value, label]) => (
            <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)} className={`flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-sm whitespace-nowrap ${view === value ? 'bg-accent font-medium text-accent-ink' : 'text-muted'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {view !== 'family' && <FamilyFilter families={families.data?.families ?? []} value={family} onChange={setFamily} />}
          {view !== 'month' && (
            <>
              <select className="input w-auto flex-1 sm:flex-none" aria-label="Sắp xếp" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="next">Gần nhất trước</option>
                <option value="lunar">Theo ngày âm</option>
                <option value="name">Theo tên</option>
              </select>
              <select className="input w-auto flex-1 sm:flex-none" aria-label="Lọc theo tháng dương" value={solarMonth} onChange={(e) => setSolarMonth(e.target.value)}>
                <option value="">Mọi tháng</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    Tháng {i + 1}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      {view === 'month' ? <ByMonthView q={q} family={family} /> : <ListView q={q} sort={sort} solarMonth={solarMonth} family={view === 'family' ? '' : family} grouped={view === 'family'} />}
    </>
  );
}
