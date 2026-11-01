import type { ISODate } from '../utils/dates';

export type LeapMonthRule = 'exact' | 'regular' | 'leap_if_available' | 'both';
export type MissingDayRule = 'skip' | 'last_day' | 'next_day';

export const LEAP_MONTH_RULES: LeapMonthRule[] = ['exact', 'regular', 'leap_if_available', 'both'];
export const MISSING_DAY_RULES: MissingDayRule[] = ['skip', 'last_day', 'next_day'];

/** Phần dữ liệu đủ để tính lịch của một ngày giỗ. */
export interface LunarRule {
  lunarDay: number;
  lunarMonth: number;
  isLeapMonth: boolean;
  leapMonthRule: LeapMonthRule;
  missingDayRule: MissingDayRule;
}

export type Channel = 'telegram' | 'zalo';

export const CHANNELS: Channel[] = ['telegram', 'zalo'];

export interface Family {
  id: number;
  name: string;
  /** Tên đăng nhập của gia đình; null nếu chưa cấp tài khoản. */
  username: string | null;
  eventCount: number;
}

export type AuthInfo = { role: 'admin' } | { role: 'family'; familyId: number; familyName: string };

export interface MemorialEventInput extends LunarRule {
  fullName: string;
  relationship: string;
  familyId: number | null;
  deathYear: number | null;
  deathSolarDate: ISODate | null;
  notes: string;
  reminderEnabled: boolean;
  /** null = dùng cấu hình nhắc chung. */
  reminderOffsets: number[] | null;
}

export interface MemorialEvent extends MemorialEventInput {
  id: number;
  familyName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Một lần diễn ra ngày giỗ, đã có ngày dương cụ thể. */
export interface Occurrence {
  solarDate: ISODate;
  /** Ngày/tháng âm theo cấu hình của ngày giỗ. */
  lunarDay: number;
  lunarMonth: number;
  lunarYear: number;
  isLeapMonth: boolean;
  /** Khác 'none' khi ngày gốc không tồn tại và đã áp dụng quy tắc đã cấu hình. */
  adjustment: 'none' | 'last_day' | 'next_day';
}

/** Ngày âm không tồn tại trong năm và không có quy tắc thay thế: cần người dùng xử lý. */
export interface UnresolvedOccurrence {
  lunarDay: number;
  lunarMonth: number;
  lunarYear: number;
  isLeapMonth: boolean;
  reason: 'leap_month_missing' | 'day_missing';
  /** Ngày dương gần với vị trí đáng ra diễn ra, chỉ dùng để xếp vào khoảng thời gian. */
  anchorDate: ISODate;
}

export interface OccurrenceItem {
  event: MemorialEvent;
  occurrence: Occurrence;
  daysLeft: number;
}

export interface UnresolvedItem {
  event: MemorialEvent;
  unresolved: UnresolvedOccurrence;
}

export interface NotificationChat {
  id: number;
  channel: Channel;
  chatId: string;
  title: string;
  canQuery: boolean;
  receiveNotifications: boolean;
  /** false: chỉ thấy các gia đình trong familyIds. */
  allFamilies: boolean;
  familyIds: number[];
  createdAt: string;
  /** false: chat dùng chung với gia đình khác, tài khoản gia đình chỉ được gỡ khỏi gia đình mình. */
  editable: boolean;
}

export interface ReminderSetting {
  daysBefore: number;
  enabled: boolean;
}

export type NotificationStatus = 'pending' | 'sending' | 'sent' | 'failed';

export interface NotificationLog {
  id: number;
  kind: 'reminder' | 'test';
  channel: Channel;
  eventId: number | null;
  eventName: string;
  occurrenceDate: string | null;
  daysBefore: number | null;
  scheduledDate: string;
  chatId: string;
  status: NotificationStatus;
  attempts: number;
  errorMessage: string | null;
  sentAt: string | null;
  createdAt: string;
}

/** Sự kiện kèm dữ liệu đã tính, trả về cho frontend. */
export interface EventView extends MemorialEvent {
  next: (Occurrence & { daysLeft: number }) | null;
  thisYear: Occurrence[];
  unresolved: UnresolvedOccurrence[];
}

export interface CronRunResult {
  ranAt: string;
  today: ISODate;
  due: number;
  sent: number;
  failed: number;
  skipped: number;
  note?: string;
}

export interface DashboardData {
  today: ISODate;
  counts: {
    total: number;
    today: number;
    thisMonth: number;
    upcoming: number;
    unresolved: number;
  };
  todayItems: ItemDTO[];
  upcoming: ItemDTO[];
  unresolved: { eventId: number; fullName: string; relationship: string; unresolved: UnresolvedOccurrence }[];
  channelsConfigured: Channel[];
  activeChats: number;
  lastCron: CronRunResult | null;
}

/** Bản rút gọn của OccurrenceItem cho danh sách và lịch. */
export interface ItemDTO {
  eventId: number;
  fullName: string;
  relationship: string;
  familyId: number | null;
  familyName: string | null;
  notes: string;
  occurrence: Occurrence;
  daysLeft: number;
}

export interface CalendarData {
  year: number;
  month: number;
  items: ItemDTO[];
  unresolved: { eventId: number; fullName: string; relationship: string; unresolved: UnresolvedOccurrence }[];
}

export interface ChannelStatus {
  channel: Channel;
  tokenConfigured: boolean;
  webhookSecretConfigured: boolean;
  bot: { name: string } | null;
  webhook: { url: string; pendingUpdates: number | null; lastError: string | null } | null;
  expectedWebhookUrl: string;
  error: string | null;
}

export interface Registration {
  id: number;
  channel: Channel;
  chat_id: string;
  full_name: string;
  family_id: number;
  family_name: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_notice_error: string | null;
  result_notice_error: string | null;
  created_at: string;
  reviewed_at: string | null;
}
export interface RegistrationAdmin { channel: Channel; chatId: string }
