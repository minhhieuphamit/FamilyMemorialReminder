/** Nhận diện lệnh và câu tiếng Việt tự nhiên bằng từ khóa, chấp nhận gõ không dấu. */
import { normalizeVietnamese } from '../utils/text';

export type Intent =
  | { type: 'start' }
  | { type: 'help' }
  | { type: 'chat_id' }
  | { type: 'today' }
  | { type: 'tomorrow' }
  | { type: 'this_month' }
  | { type: 'lunar_month' }
  | { type: 'next_month' }
  | { type: 'specific_month'; month: number }
  | { type: 'this_week' }
  | { type: 'next_week' }
  | { type: 'upcoming' }
  | { type: 'this_year' }
  | { type: 'nearest' }
  | { type: 'search'; query: string }
  | { type: 'family'; query: string }
  | { type: 'person'; query: string }
  | { type: 'unknown'; isCommand: boolean };

const COMMANDS: Record<string, Intent['type']> = {
  start: 'start',
  help: 'help',
  id: 'chat_id',
  homnay: 'today',
  ngaymai: 'tomorrow',
  thangnay: 'this_month',
  thangam: 'lunar_month',
  thangtoi: 'next_month',
  tuannay: 'this_week',
  tuantoi: 'next_week',
  saptoi: 'upcoming',
  namnay: 'this_year',
  gannhat: 'nearest',
};

const PERSON_QUESTION = /\b(con bao nhieu ngay|con may ngay|con bao lau|bao lau nua|khi nao|bao gio|ngay nao|ngay may|ngay bao nhieu|hom nao)\b/;

// Từ để hỏi và từ đệm, bỏ đi để còn lại tên người. Cụm dài đặt trước cụm ngắn.
const STOP_PHRASES = [
  'con bao nhieu ngay', 'con may ngay', 'con bao lau', 'bao lau nua', 'la khi nao', 'khi nao', 'bao gio',
  'la ngay nao', 'ngay nao', 'ngay may', 'ngay bao nhieu', 'hom nao', 'gan nhat', 'ke tiep', 'tiep theo',
  'ngay gio', 'dam gio', 'gio', 'cua', 'la', 'nua', 'vay', 'nhe', 'a', 'cho', 'minh', 'toi', 'hoi', 'xem', 'co',
];
const STOP_REGEX = new RegExp(`\\b(${STOP_PHRASES.join('|')})\\b`, 'g');

export function extractSubject(normalized: string): string {
  return normalized.replace(STOP_REGEX, ' ').replace(/\s+/g, ' ').trim();
}

function parseCommand(text: string): Intent {
  const match = text.match(/^\/([a-zA-Z_]+)(?:@\S+)?(?:\s+([\s\S]*))?$/);
  if (!match) return { type: 'unknown', isCommand: true };
  const name = match[1].toLowerCase();
  const args = (match[2] ?? '').trim();
  if (name === 'tim') return { type: 'search', query: args };
  if (name === 'giadinh') return { type: 'family', query: args };
  const type = COMMANDS[name];
  return type ? ({ type } as Intent) : { type: 'unknown', isCommand: true };
}

/**
 * Nhóm Zalo chỉ gửi tin có nhắc tên bot, và nội dung còn nguyên "@Tên bot". Bỏ phần này để lệnh và câu hỏi
 * được hiểu như nhắn riêng; tên bot có từ "giỗ", "gia đình" nên để lại sẽ làm nhận diện sai.
 */
export function stripBotMention(text: string, botName = ''): { text: string; mentioned: boolean } {
  const tokens = text.trim().split(/\s+/);
  const size = normalizeVietnamese(botName).split(' ').length;
  const start = botName
    ? tokens.findIndex((t, i) => t.startsWith('@') && normalizeVietnamese(tokens.slice(i, i + size).join(' ')) === normalizeVietnamese(botName))
    : -1;
  if (start >= 0) {
    tokens.splice(start, size);
    return { text: tokens.join(' ') || '/help', mentioned: true };
  }
  // Đổi tên bot mà chưa cập nhật cấu hình thì vẫn nhận được lệnh, dù chưa bỏ được tên khỏi câu tự nhiên.
  const command = text.trim().match(/^@.*?\s(\/[a-zA-Z_][\s\S]*)$/);
  return command ? { text: command[1], mentioned: true } : { text, mentioned: false };
}

/** Câu hỏi về danh sách gia đình và trạng thái tham gia; câu nhắc đến ngày giỗ vẫn là tra cứu. */
export function isFamilyDirectoryQuestion(text: string): boolean {
  const n = normalizeVietnamese(text);
  if (text.trim().startsWith('/') || /\b(gio|ngay|tuan|thang)\b/.test(n)) return false;
  return (
    /^(xem )?((cac|nhung) )?gia dinh$/.test(n) ||
    /\b(danh sach|liet ke|trang thai)\b.*\bgia dinh\b/.test(n) ||
    /\bgia dinh nao( (vay|the|nhi|a|ha|nhe))*$/.test(n) ||
    /\b(tham gia|dang ky)\b.*\b(gia dinh|nha nao)\b/.test(n) ||
    /\bgia dinh\b.*\b(tham gia|dang ky)\b/.test(n)
  );
}

export function parseMessage(text: string): Intent {
  const trimmed = text.trim();
  if (trimmed.startsWith('/')) return parseCommand(trimmed);

  const n = normalizeVietnamese(trimmed);
  if (!n) return { type: 'unknown', isCommand: false };

  const search = n.match(/^tim(?: kiem)? (.+)$/);
  if (search) return { type: 'search', query: search[1] };

  if (/\b(gan nhat|ke tiep|tiep theo)\b/.test(n)) {
    const subject = extractSubject(n);
    return subject ? { type: 'person', query: subject } : { type: 'nearest' };
  }
  if (/\bthang (nay )?(am|am lich)\b/.test(n) || /\bam lich thang nay\b/.test(n)) return { type: 'lunar_month' };
  if (/\bthang (sau|toi|ke tiep)\b/.test(n)) return { type: 'next_month' };
  if (/\bthang nay\b/.test(n)) return { type: 'this_month' };
  const monthNumber = n.match(/\bthang (\d{1,2})\b/);
  if (monthNumber && +monthNumber[1] >= 1 && +monthNumber[1] <= 12) {
    return { type: 'specific_month', month: +monthNumber[1] };
  }
  if (/\btuan (toi|sau)\b/.test(n)) return { type: 'next_week' };
  if (/\btuan nay\b/.test(n)) return { type: 'this_week' };
  if (/\bhom nay\b/.test(n)) return { type: 'today' };
  if (/\bngay mai\b/.test(n)) return { type: 'tomorrow' };
  if (/\b(sap toi|sap den|30 ngay)\b/.test(n)) return { type: 'upcoming' };
  if (/\b(nam nay|ca nam|trong nam)\b/.test(n)) return { type: 'this_year' };

  if (PERSON_QUESTION.test(n) || /\b(gio|dam gio)\b/.test(n)) {
    const subject = extractSubject(n);
    return subject ? { type: 'person', query: subject } : { type: 'nearest' };
  }
  if (/\b(huong dan|tro giup|giup|help)\b/.test(n)) return { type: 'help' };
  if (/^(chao|xin chao|hello|hi)\b/.test(n)) return { type: 'start' };
  return { type: 'unknown', isCommand: false };
}
