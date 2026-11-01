import { Link } from 'react-router';
import { formatLunarLabel } from '../../../src/services/occurrences';
import type { ItemDTO, UnresolvedOccurrence } from '../../../src/types/domain';
import { formatDateVN, weekdayLabel } from '../../../src/utils/dates';
import { useAuth } from '../lib/auth';
import { unresolvedReason } from '../lib/labels';
import { DaysBadge } from './ui';

export function adjustmentNote(adjustment: ItemDTO['occurrence']['adjustment']): string | null {
  if (adjustment === 'last_day') return 'tháng thiếu, dùng ngày cuối tháng';
  if (adjustment === 'next_day') return 'tháng thiếu, dùng mùng 1 tháng sau';
  return null;
}

/** Một dòng ngày giỗ đã có ngày dương cụ thể. */
export function OccurrenceRow({ item }: { item: ItemDTO }) {
  const { occurrence: o } = item;
  const note = adjustmentNote(o.adjustment);
  const { isAdmin } = useAuth();
  return (
    <Link to={`/ngay-gio/${item.eventId}`} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-subtle">
      <div className="min-w-0">
        <p className="truncate font-medium">{item.fullName}</p>
        <p className="mt-0.5 text-sm text-muted">
          {isAdmin && item.familyName && `${item.familyName} · `}
          {item.relationship && `${item.relationship} · `}
          {formatLunarLabel(o)} âm · {weekdayLabel(o.solarDate)} {formatDateVN(o.solarDate)}
        </p>
        {note && <p className="mt-0.5 text-xs text-warn">{note}</p>}
      </div>
      <DaysBadge days={item.daysLeft} />
    </Link>
  );
}

export function UnresolvedRow(props: { eventId: number; fullName: string; relationship: string; unresolved: UnresolvedOccurrence }) {
  return (
    <Link to={`/ngay-gio/${props.eventId}`} className="block px-4 py-3 hover:bg-warn-soft">
      <p className="font-medium">
        {props.fullName} {props.relationship && <span className="font-normal text-muted">({props.relationship})</span>}
      </p>
      <p className="mt-0.5 text-sm text-warn">
        {formatLunarLabel(props.unresolved)} âm: {unresolvedReason(props.unresolved)}. Chọn quy tắc để có ngày cúng.
      </p>
    </Link>
  );
}
