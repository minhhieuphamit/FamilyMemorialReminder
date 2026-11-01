/**
 * Thiệp nhắc ngày giỗ dạng ảnh. Nội dung lấy từ ngày giỗ, ảnh do Cloudflare Browser Run chụp từ HTML:
 * Worker chỉ gọi API rồi chờ, thời gian chờ không tính vào giới hạn 10 ms CPU của Free Plan.
 */
import { CARD_BACKGROUND } from './card-background';
import { findCardToken, saveCard } from '../database/cards-repo';
import type { Env } from '../types/env';
import { randomToken, sha256Hex } from '../utils/crypto';
import { formatDateVN } from '../utils/dates';
import { escapeHtml } from '../utils/text';
import type { ReminderItem } from './message-format';
import { formatLunarLabel } from './occurrences';

const VIEWPORT = { width: 1200, height: 800 };
/** Free Plan cho phép 1 yêu cầu mỗi 10 giây và 10 phút trình duyệt mỗi ngày. */
const MIN_RENDER_GAP_MS = 10_500;
/** Quá số này trong một lượt thì các nhắc còn lại gửi bằng chữ, để lượt chạy không kéo dài. */
export const MAX_RENDERS_PER_RUN = 6;
const MAX_CAPTION_NOTE = 300;

export interface CardProvider {
  /** Địa chỉ công khai của ảnh thiệp, hoặc null nếu không tạo được; khi đó nhắc được gửi bằng chữ. */
  imageUrlFor(item: ReminderItem): Promise<string | null>;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function remainingLabel(daysBefore: number): string {
  return daysBefore === 0 ? 'Hôm nay' : daysBefore === 1 ? 'Ngày mai' : `Còn ${daysBefore} ngày`;
}

const ICONS = {
  person: '<circle cx="12" cy="7.500" r="4.500"/><path d="M3 22c0-5 4-8.500 9-8.500s9 3.500 9 8.500z"/>',
  home: '<path d="M12 2.500 1.500 11.500H5V21.500h5v-6.500h4v6.500h5V11.500h3.500z"/>',
  calendar: '<path d="M7 1.500h2.500V4h5V1.500H17V4h4.500v17.500h-19V4H7zM5 9.500v9.500h14V9.500z"/><path d="M7 11.500h3v3H7zm4 0h3v3h-3zm4 0h2v3h-2z"/>',
  hourglass: '<path d="M5 2h14v2h-1.500c0 4-2 6.500-4 8 2 1.500 4 4 4 8H19v2H5v-2h1.500c0-4 2-6.500 4-8-2-1.500-4-4-4-8H5zm3.500 2c0 3 1.500 5 3.500 6.500 2-1.500 3.500-3.500 3.500-6.500z"/>',
};

function row(icon: keyof typeof ICONS, label: string, value: string, valueClass = ''): string {
  return `<div class="row"><svg viewBox="0 0 24 24">${ICONS[icon]}</svg><span class="label">${label}</span><span class="value ${valueClass}">${value}</span></div>`;
}

/** HTML tự chứa nền, dùng font hệ thống để không chụp trúng lúc web font đang ẩn chữ (font-display:block). */
export function renderCardHtml(item: ReminderItem, _baseUrl: string): string {
  const { event, occurrence, daysBefore } = item;
  // Giới hạn độ dài để tên rất dài không tràn khung ảnh; chú thích đi kèm vẫn có tên đầy đủ.
  const fullName = clip(event.fullName, 45);
  const relationship = clip(event.relationship, 24);
  const familyName = clip(event.familyName ?? '', 40);
  const name = escapeHtml(fullName);
  const person = relationship ? `${name} <small>(${escapeHtml(relationship)})</small>` : name;
  const nameSize = fullName.length + relationship.length > 30 ? 'long' : '';

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0}
body{width:${VIEWPORT.width}px;height:${VIEWPORT.height}px;overflow:hidden;position:relative;font-family:Georgia,'Times New Roman',serif;color:#3f2a1d;background:linear-gradient(120deg,#f6ecd9,#efe0c6 70%,#e8d3b3)}
.photo{position:absolute;left:0;top:0;width:450px;height:800px;object-fit:fill;-webkit-mask-image:linear-gradient(90deg,#000 92%,transparent)}
.sun{position:absolute;right:70px;top:30px;width:120px;height:120px;border-radius:50%;background:radial-gradient(circle,#f3c58a,#eaa968);opacity:.65}
.hills{position:absolute;right:0;bottom:0;width:820px;height:190px;fill:#d9bf98;opacity:.55}
.title{position:absolute;left:405px;top:104px;width:720px;height:108px;display:flex;align-items:center;justify-content:center;gap:18px;border-radius:56px;background:linear-gradient(90deg,#7a2a1c,#96402a);border:3px solid #d7ac62;color:#fff5e1;font-size:45px;font-weight:700;box-shadow:0 8px 24px rgba(74,32,17,.3)}
.title svg{width:50px;height:50px;fill:#eec36e}
.panel{position:absolute;left:439px;top:240px;width:720px;padding:16px 52px;background:linear-gradient(110deg,#fff3dceF,#fff8e9e8);border:2px solid #d7ac62;outline:1px solid #d7ac62;outline-offset:-10px;border-radius:26px;box-shadow:0 10px 30px rgba(74,32,17,.18)}
.row{display:flex;align-items:center;gap:18px;padding:17px 0;border-bottom:1px solid #e0d0b2}
.panel:before,.panel:after{content:"❖";position:absolute;color:#cf9b49;font-size:24px;right:13px}
.panel:before{top:4px}.panel:after{bottom:4px}
.row:last-child{border-bottom:0}
.row svg{width:42px;height:42px;fill:#8d5a33;flex:none}
.label{font-size:32px;color:#5a4030;white-space:nowrap}
.value{font-size:39px;font-weight:700;color:#7f2518;line-height:1.2;min-width:0;overflow-wrap:anywhere}
.value.long{font-size:28px}
.value small{font-size:.72em;font-weight:600;color:#7a5a45}
.pill{display:inline-block;padding:7px 30px;border-radius:30px;background:#a8422e;color:#fff5e1;font-size:31px}
.note{margin-top:4px;font-size:21px;font-weight:400;color:#8a5a2f}
</style></head><body>
<img class="photo" src="${CARD_BACKGROUND}" alt="">
<div class="sun"></div>
<svg class="hills" viewBox="0 0 820 190" preserveAspectRatio="none"><path d="M0 190C120 110 200 150 300 100s150 10 240-30 170 20 280-20v140z"/></svg>
<div class="title"><svg viewBox="0 0 24 24"><path d="M12 2a2 2 0 0 1 2 2v.600c3.500.900 5.500 4 5.500 7.400 0 3.500 1 5 2.500 6.500v1H2v-1c1.500-1.500 2.500-3 2.500-6.500 0-3.400 2-6.500 5.500-7.400V4a2 2 0 0 1 2-2zm-2.500 19h5a2.500 2.500 0 0 1-5 0z"/></svg>Nhắc Ngày Giỗ Gia Đình</div>
<div class="panel">
${row('person', 'Người mất:', person, nameSize)}
${familyName ? row('home', 'Gia đình:', escapeHtml(familyName), familyName.length > 24 ? 'long' : '') : ''}
${row('calendar', 'Ngày giỗ âm:', formatLunarLabel(occurrence))}
${row('calendar', 'Ngày dương:', formatDateVN(occurrence.solarDate))}
${row('hourglass', 'Còn lại:', `<span class="pill">${remainingLabel(daysBefore)}</span>`)}
</div></body></html>`;
}

/** Phần chữ gửi kèm ảnh, viết theo HTML của Telegram; Zalo tự chuyển sang văn bản thuần. */
export function cardCaption(item: ReminderItem): string {
  const { event, occurrence, daysBefore } = item;
  const relationship = event.relationship ? ` (${escapeHtml(event.relationship)})` : '';
  const family = event.familyName ? ` thuộc ${escapeHtml(event.familyName)}` : '';
  const who = `<b>${escapeHtml(event.fullName)}</b>${relationship}${family}`;
  const lines = [
    daysBefore === 0 ? '🕯️ <b>TƯỞNG NHỚ NGÀY GIỖ</b>' : '🔔 <b>NHẮC NGÀY GIỖ</b>',
    '',
    daysBefore === 0
      ? `Hôm nay là ngày giỗ của ${who}.`
      : `${daysBefore === 1 ? 'Ngày mai' : `Còn ${daysBefore} ngày nữa`} là ngày giỗ của ${who}.`,
    '',
    `📅 ${formatLunarLabel(occurrence)} Âm lịch — ${formatDateVN(occurrence.solarDate)} Dương lịch`,
  ];
  if (occurrence.adjustment === 'last_day') lines.push('(tháng thiếu, dùng ngày cuối tháng)');
  if (occurrence.adjustment === 'next_day') lines.push('(tháng thiếu, dùng mùng 1 tháng sau)');
  if (event.notes) lines.push('', `📝 ${escapeHtml(event.notes.slice(0, MAX_CAPTION_NOTE))}`);
  if (daysBefore === 0) lines.push('', '🌿 Một ngày để gia đình cùng tưởng nhớ và gìn giữ những kỷ niệm thân thương.');
  return lines.join('\n');
}

export interface CardOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Mặc định MAX_RENDERS_PER_RUN. Trả lời webhook đặt thấp hơn để không vượt thời gian chờ của nền tảng. */
  maxRenders?: number;
}

export function isCardConfigured(env: Env): boolean {
  return Boolean(env.PUBLIC_BASE_URL && env.BROWSER_RUN_TOKEN && (env.BROWSER_RUN_ACCOUNT_ID || env.BROWSER_RUN_ENDPOINT));
}

/** Chụp HTML thành ảnh JPEG. Lỗi có thông báo rõ nhưng không chứa token. */
export async function renderCardImage(env: Env, html: string, doFetch: typeof fetch = (i, init) => fetch(i, init)): Promise<ArrayBuffer> {
  const endpoint =
    env.BROWSER_RUN_ENDPOINT ?? `https://api.cloudflare.com/client/v4/accounts/${env.BROWSER_RUN_ACCOUNT_ID}/browser-rendering/screenshot`;
  const res = await doFetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.BROWSER_RUN_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      html,
      viewport: VIEWPORT,
      screenshotOptions: { type: 'jpeg', quality: 85 },
      gotoOptions: { waitUntil: 'networkidle0', timeout: 30_000 },
    }),
  });
  if (res.ok && (res.headers.get('content-type') ?? '').startsWith('image/')) return res.arrayBuffer();
  const body = (await res.json().catch(() => null)) as { errors?: { message?: string }[] } | null;
  throw new CardRenderError(res.status, body?.errors?.[0]?.message ?? `HTTP ${res.status}`);
}

export class CardRenderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Trả về null nếu chưa cấu hình. Cùng nội dung thiệp thì dùng lại ảnh đã có, nên gửi cho nhiều chat
 * hay chạy lại đều không tốn thêm lượt tạo ảnh.
 */
export function createCardProvider(env: Env, options: CardOptions = {}): CardProvider | null {
  if (!isCardConfigured(env)) return null;
  const baseUrl = env.PUBLIC_BASE_URL!.replace(/\/+$/, '');
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const maxRenders = options.maxRenders ?? MAX_RENDERS_PER_RUN;
  let renders = 0;
  let lastRenderAt = 0;
  let stopped = false;

  return {
    async imageUrlFor(item) {
      const html = renderCardHtml(item, baseUrl);
      const hash = await sha256Hex(html);
      const existing = await findCardToken(env.DB, hash);
      if (existing) return `${baseUrl}/cards/${existing}.jpg`;
      if (stopped || renders >= maxRenders) return null;

      const wait = lastRenderAt + MIN_RENDER_GAP_MS - now();
      if (renders > 0 && wait > 0) await sleep(wait);
      renders++;
      lastRenderAt = now();
      try {
        const image = await renderCardImage(env, html, options.fetch);
        const token = randomToken();
        await saveCard(env.DB, token, hash, image);
        return `${baseUrl}/cards/${(await findCardToken(env.DB, hash)) ?? token}.jpg`;
      } catch (err) {
        // Hết hạn mức hoặc sai token thì các ảnh sau cũng lỗi, nên dừng hẳn cho lượt này.
        if (err instanceof CardRenderError && [401, 403, 429].includes(err.status)) stopped = true;
        console.warn(`Không tạo được ảnh thiệp, sẽ gửi bằng chữ: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
  };
}
