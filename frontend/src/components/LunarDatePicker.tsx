import { useState } from 'react';
import { getLeapMonth, getLunarMonthLength, lunarToSolar, lunarYearName } from '../../../src/utils/lunar-calendar';

export interface LunarValue {
  day: number;
  month: number;
  isLeap: boolean;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/**
 * Chọn ngày âm lịch: chọn tháng (có tháng nhuận nếu năm đang xem có), rồi chọn ngày.
 * Mỗi ô ngày hiện ngày dương tương ứng của năm đang xem để dễ đối chiếu.
 */
export function LunarDatePicker(props: { value: LunarValue; onChange: (v: LunarValue) => void; year: number; onYearChange: (y: number) => void }) {
  const { value, onChange, year, onYearChange } = props;
  const [open, setOpen] = useState(false);

  const leapMonth = getLeapMonth(year);
  const monthExists = !value.isLeap || leapMonth === value.month;
  const monthLength = monthExists ? getLunarMonthLength(year, value.month, value.isLeap) : null;

  const months: { month: number; isLeap: boolean }[] = [];
  for (let m = 1; m <= 12; m++) {
    months.push({ month: m, isLeap: false });
    if (leapMonth === m) months.push({ month: m, isLeap: true });
  }
  // Giữ lại tháng nhuận đang chọn dù năm đang xem không có, để không mất lựa chọn của người dùng.
  if (value.isLeap && leapMonth !== value.month) {
    months.splice(months.findIndex((m) => m.month === value.month) + 1, 0, { month: value.month, isLeap: true });
  }

  return (
    <div>
      <button type="button" className="input flex cursor-pointer items-center justify-between text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="font-medium">
          {pad(value.day)}/{pad(value.month)} âm lịch{value.isLeap ? ' (tháng nhuận)' : ''}
        </span>
        <span className="text-xs text-muted">{open ? 'Đóng' : 'Chọn ngày'}</span>
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-line bg-subtle p-3">
          <div className="mb-3 flex items-center justify-between">
            <button type="button" className="btn btn-sm" aria-label="Năm trước" onClick={() => onYearChange(year - 1)}>
              ‹
            </button>
            <div className="text-center text-sm font-medium">
              Năm âm {year} ({lunarYearName(year)})
              <div className="text-xs font-normal text-muted">{leapMonth ? `Nhuận tháng ${leapMonth}` : 'Không có tháng nhuận'}</div>
            </div>
            <button type="button" className="btn btn-sm" aria-label="Năm sau" onClick={() => onYearChange(year + 1)}>
              ›
            </button>
          </div>

          <p className="mb-1.5 text-xs font-medium text-muted">Tháng</p>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
            {months.map((m) => {
              const selected = m.month === value.month && m.isLeap === value.isLeap;
              const missing = m.isLeap && leapMonth !== m.month;
              return (
                <button
                  key={`${m.month}${m.isLeap}`}
                  type="button"
                  aria-pressed={selected}
                  className={`chip ${selected ? 'chip-on' : ''} ${missing ? 'border-dashed' : ''}`}
                  onClick={() => onChange({ ...value, month: m.month, isLeap: m.isLeap })}
                >
                  {m.month}
                  {m.isLeap ? ' nhuận' : ''}
                </button>
              );
            })}
          </div>

          <p className="mt-3 mb-1.5 text-xs font-medium text-muted">Ngày</p>
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-7">
            {Array.from({ length: 30 }, (_, i) => i + 1).map((day) => {
              const selected = day === value.day;
              const solar = monthExists ? lunarToSolar({ day, month: value.month, year, isLeap: value.isLeap }) : null;
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={selected}
                  className={`chip flex-col py-1 leading-tight ${selected ? 'chip-on' : ''} ${monthExists && !solar ? 'border-dashed' : ''}`}
                  onClick={() => onChange({ ...value, day })}
                >
                  <span className="font-medium">{day}</span>
                  <span className={`text-[10px] ${selected ? '' : 'text-muted'}`}>{solar ? `${pad(solar.day)}/${pad(solar.month)}` : monthExists ? 'thiếu' : '–'}</span>
                </button>
              );
            })}
          </div>

          <p className="hint">
            {!monthExists
              ? `Năm âm ${year} không có tháng ${value.month} nhuận. Dùng nút ‹ › để xem năm có tháng này.`
              : monthLength === 29
                ? `Tháng này năm ${year} là tháng thiếu (29 ngày). Vẫn có thể chọn ngày 30 vì năm khác có thể là tháng đủ.`
                : `Tháng này năm ${year} là tháng đủ (30 ngày). Số nhỏ dưới mỗi ô là ngày dương của năm đang xem.`}
          </p>
        </div>
      )}
    </div>
  );
}
