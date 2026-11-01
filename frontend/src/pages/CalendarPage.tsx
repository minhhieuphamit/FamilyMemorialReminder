import { useMemo, useState } from 'react';
import type { CalendarData, Family } from '../../../src/types/domain';
import { daysInSolarMonth, formatDateVN, nextSolarMonth, parseISODate, toISODate, todayInVietnam, weekdayOf } from '../../../src/utils/dates';
import { lunarYearName, solarToLunar } from '../../../src/utils/lunar-calendar';
import { OccurrenceRow, UnresolvedRow } from '../components/EventRow';
import { FamilyFilter } from '../components/FamilyFilter';
import { ErrorBox, Loading, PageHeader } from '../components/ui';
import { useApi } from '../lib/api';

const WEEK_HEADERS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

export function CalendarPage() {
  const today = todayInVietnam();
  const now = parseISODate(today);
  const [cursor, setCursor] = useState({ year: now.year, month: now.month });
  const [selected, setSelected] = useState<string | null>(today);
  const [family, setFamily] = useState('');
  const families = useApi<{ families: Family[] }>('/families');
  const { data, error, loading, reload } = useApi<CalendarData>(`/calendar?year=${cursor.year}&month=${cursor.month}${family ? `&family=${family}` : ''}`);

  const cells = useMemo(() => {
    const first = toISODate(cursor.year, cursor.month, 1);
    const leading = (weekdayOf(first) + 6) % 7;
    const days = Array.from({ length: daysInSolarMonth(cursor.year, cursor.month) }, (_, i) => {
      const date = toISODate(cursor.year, cursor.month, i + 1);
      return { date, day: i + 1, lunar: solarToLunar(parseISODate(date)) };
    });
    return { leading, days };
  }, [cursor]);

  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarData['items']>();
    for (const item of data?.items ?? []) {
      map.set(item.occurrence.solarDate, [...(map.get(item.occurrence.solarDate) ?? []), item]);
    }
    return map;
  }, [data]);

  function move(delta: 1 | -1) {
    setSelected(null);
    setCursor((c) => (delta === 1 ? nextSolarMonth(c.year, c.month) : c.month === 1 ? { year: c.year - 1, month: 12 } : { year: c.year, month: c.month - 1 }));
  }

  const midLunar = cells.days[14].lunar;
  const selectedItems = selected ? (itemsByDate.get(selected) ?? []) : [];
  const shownItems = selected ? selectedItems : (data?.items ?? []);

  return (
    <>
      <PageHeader title="Lịch tháng" action={<FamilyFilter families={families.data?.families ?? []} value={family} onChange={setFamily} />} />

      <div className="card p-3 md:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <button type="button" className="btn btn-sm" aria-label="Tháng trước" onClick={() => move(-1)}>
            ‹
          </button>
          <div className="text-center">
            <p className="font-semibold">
              Tháng {cursor.month}/{cursor.year}
            </p>
            <p className="text-xs text-muted">Năm âm {lunarYearName(midLunar.year)}</p>
          </div>
          <button type="button" className="btn btn-sm" aria-label="Tháng sau" onClick={() => move(1)}>
            ›
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted">
          {WEEK_HEADERS.map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: cells.leading }, (_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {cells.days.map(({ date, day, lunar }) => {
            const items = itemsByDate.get(date) ?? [];
            const isToday = date === today;
            const isSelected = date === selected;
            const lunarText = lunar.day === 1 ? `${lunar.day}/${lunar.month}${lunar.isLeap ? 'N' : ''}` : String(lunar.day);
            return (
              <button
                key={date}
                type="button"
                aria-pressed={isSelected}
                aria-label={`${formatDateVN(date)}, âm lịch ${lunar.day}/${lunar.month}${lunar.isLeap ? ' nhuận' : ''}${items.length ? `, ${items.length} ngày giỗ` : ''}`}
                onClick={() => setSelected(isSelected ? null : date)}
                className={`flex min-h-14 cursor-pointer flex-col rounded-lg border p-1 text-left transition-colors md:min-h-24 md:p-1.5 ${
                  isSelected ? 'border-accent' : 'border-transparent hover:bg-subtle'
                } ${items.length > 0 ? 'bg-accent-soft' : ''}`}
              >
                <span className="flex items-baseline justify-between gap-1">
                  <span className={`text-sm font-medium tabular-nums ${isToday ? 'rounded-full bg-accent px-1.5 text-accent-ink' : ''}`}>{day}</span>
                  <span className={`text-[10px] tabular-nums ${lunar.day === 1 ? 'font-semibold text-accent' : 'text-muted'}`}>{lunarText}</span>
                </span>
                {items.length > 0 && (
                  <>
                    <span className="mt-auto flex gap-0.5 md:hidden">
                      {items.slice(0, 3).map((item) => (
                        <span key={item.eventId} className="size-1.5 rounded-full bg-accent" />
                      ))}
                    </span>
                    <span className="mt-1 hidden space-y-0.5 md:block">
                      {items.slice(0, 2).map((item) => (
                        <span key={item.eventId} className="block truncate text-[11px] font-medium text-accent">
                          {item.relationship || item.fullName}
                        </span>
                      ))}
                      {items.length > 2 && <span className="block text-[10px] text-muted">+{items.length - 2} nữa</span>}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <section className="mt-5">
        <h2 className="mb-2 font-semibold">{selected ? `Ngày ${formatDateVN(selected)}` : `Cả tháng ${cursor.month}/${cursor.year}`}</h2>
        {loading && !data && <Loading />}
        {error && <ErrorBox message={error} onRetry={reload} />}
        {data &&
          (shownItems.length > 0 ? (
            <div className="card divide-y divide-line overflow-hidden">
              {shownItems.map((item) => (
                <OccurrenceRow key={`${item.eventId}-${item.occurrence.solarDate}`} item={item} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Không có ngày giỗ.</p>
          ))}
        {data && !selected && data.unresolved.length > 0 && (
          <div className="card mt-3 divide-y divide-line overflow-hidden">
            {data.unresolved.map((u) => (
              <UnresolvedRow key={`${u.eventId}-${u.unresolved.lunarYear}`} {...u} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
