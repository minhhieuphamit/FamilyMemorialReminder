/**
 * Thiệp nhắc ngày giỗ dạng ảnh. Nội dung lấy từ ngày giỗ, ảnh do Cloudflare Browser Run chụp từ HTML:
 * Worker chỉ gọi API rồi chờ, thời gian chờ không tính vào giới hạn 10 ms CPU của Free Plan.
 */
import { CARD_BACKGROUND } from './card-background';
import { CARD_FONT_CSS } from './card-fonts';
import { findCardToken, saveCard } from '../database/cards-repo';
import type { Env } from '../types/env';
import { randomToken, sha256Hex } from '../utils/crypto';
import { formatDateVN } from '../utils/dates';
import { escapeHtml } from '../utils/text';
import type { ReminderItem } from './message-format';
import { formatLunarLabel } from './occurrences';

const VIEWPORT = { width: 1200, height: 800 };
/**
 * Free Plan cho phép 1 yêu cầu mỗi 10 giây và 1 trình duyệt mới mỗi 20 giây. Mỗi lần chụp mở một trình duyệt,
 * nên chờ hơn 20 giây tính từ lúc lần trước xong; chờ 10,5 giây từ lúc bắt đầu thì ảnh thứ hai bị 429.
 */
export const MIN_RENDER_GAP_MS = 21_000;
/** Không chờ Retry-After lâu hơn mức này; lâu hơn thì gửi bằng chữ. */
const MAX_RETRY_WAIT_MS = 60_000;
/** Số lần thử lại một ảnh khi bị giới hạn tốc độ hoặc lỗi tạm thời. */
const DEFAULT_RETRIES = 2;
/** Quá số này trong một lượt thì các nhắc còn lại gửi bằng chữ, để lượt chạy không kéo dài. */
export const MAX_RENDERS_PER_RUN = 6;
const MAX_CAPTION_NOTE = 300;
/** Tăng khi đổi mẫu thiệp của dịch vụ vẽ ảnh trên Vercel. */
const CARD_DESIGN_VERSION = 'satori-1';
/** Dịch vụ trên Vercel vẽ một ảnh dưới 1 giây; khởi động lạnh có thể vài giây. */
const SERVICE_TIMEOUT_MS = 20_000;
/** Chặn trên số ảnh mỗi lượt cho dịch vụ Vercel, chỉ để phòng vòng lặp bất thường. */
const MAX_SERVICE_RENDERS_PER_RUN = 50;
/** Chờ trước khi gọi lại dịch vụ Vercel khi lỗi tạm thời. */
const SERVICE_RETRY_DELAY_MS = 1_500;
/** Ảnh nền và font rất lớn: không băm lại mỗi lần, chỉ dùng độ dài làm phiên bản. Đổi tài nguyên thì ảnh cũ tự hết dùng. */
const ASSET_VERSION = `${CARD_BACKGROUND.length}:${CARD_FONT_CSS.length}`;

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

/** fit: chữ dài được thu nhỏ cho vừa một dòng, nhỏ tới mức tối thiểu mà vẫn tràn thì mới xuống dòng. */
function row(icon: keyof typeof ICONS, label: string, value: string, fit = true): string {
  return `<div class="row"><svg viewBox="0 0 24 24">${ICONS[icon]}</svg><span class="label">${label}</span><span class="value${fit ? ' fit' : ''}">${value}</span></div>`;
}

// Font Noto Serif nhúng sẵn (card-fonts.ts) nên dấu tiếng Việt luôn cùng một font, không bị ghép font hệ thống.
const CARD_STYLE = `*{box-sizing:border-box;margin:0}
body{width:${VIEWPORT.width}px;height:${VIEWPORT.height}px;overflow:hidden;position:relative;font-family:'Card Serif',serif;color:#3f2a1d;background:linear-gradient(120deg,#f6ecd9,#efe0c6 70%,#e8d3b3);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.photo{position:absolute;left:0;top:0;width:450px;height:800px;object-fit:fill;-webkit-mask-image:linear-gradient(90deg,#000 92%,transparent)}
.sun{position:absolute;right:70px;top:30px;width:120px;height:120px;border-radius:50%;background:radial-gradient(circle,#f3c58a,#eaa968);opacity:.65}
.hills{position:absolute;right:0;bottom:0;width:820px;height:190px;fill:#d9bf98;opacity:.55}
.title{position:absolute;left:405px;top:104px;width:720px;height:108px;display:flex;align-items:center;justify-content:center;gap:18px;padding:0 36px;border-radius:56px;background:linear-gradient(90deg,#7a2a1c,#96402a);border:3px solid #d7ac62;color:#fff5e1;font-size:42px;font-weight:700;line-height:1.3;white-space:nowrap;box-shadow:0 8px 24px rgba(74,32,17,.3)}
.title svg{width:48px;height:48px;fill:#eec36e;flex:none}
.panel{position:absolute;left:439px;top:240px;width:720px;padding:14px 48px;background:linear-gradient(110deg,#fff3dcef,#fff8e9e8);border:2px solid #d7ac62;outline:1px solid #d7ac62;outline-offset:-10px;border-radius:26px;box-shadow:0 10px 30px rgba(74,32,17,.18)}
.panel:before,.panel:after{content:"";position:absolute;right:16px;width:9px;height:9px;background:#cf9b49;transform:rotate(45deg)}
.panel:before{top:16px}.panel:after{bottom:16px}
.row{display:flex;align-items:center;gap:16px;min-height:86px;padding:12px 0;border-bottom:1px solid #e0d0b2}
.row:last-child{border-bottom:0}
.row svg{width:40px;height:40px;fill:#8d5a33;flex:none}
.label{font-size:29px;color:#5a4030;white-space:nowrap;flex:none}
.value{flex:1;min-width:0;font-size:37px;font-weight:700;color:#7f2518;line-height:1.35;white-space:nowrap;overflow:hidden;padding:2px 0}
.value.wrap{white-space:normal;overflow-wrap:anywhere;overflow:visible;line-height:1.25}
.value small{font-size:.72em;font-weight:400;color:#7a5a45}
.pill{display:inline-block;padding:4px 30px 6px;border-radius:30px;background:#a8422e;color:#fff5e1;font-size:30px;line-height:1.35}`;

/** Chờ font nhúng nạp xong, thu chữ cho vừa, rồi gắn data-ready để Browser Run mới chụp: không bao giờ chụp lúc chữ còn ẩn. */
const FIT_SCRIPT = `(function(){var done=false;function ready(){if(done)return;done=true;
document.querySelectorAll('.fit').forEach(function(el){var s=parseFloat(getComputedStyle(el).fontSize);while(el.scrollWidth>el.clientWidth+1&&s>24){s-=1;el.style.fontSize=s+'px';}if(el.scrollWidth>el.clientWidth+1)el.classList.add('wrap');});
document.documentElement.setAttribute('data-ready','1');}
Promise.all(Array.from(document.fonts,function(f){return f.load().catch(function(){});})).then(ready,ready);setTimeout(ready,4000);})();`;

/** Dữ liệu in trên thiệp, dùng chung cho dịch vụ vẽ ảnh trên Vercel (relay/lib/card.ts) và bản HTML của Browser Run. */
export interface CardData {
  name: string;
  relationship: string;
  family: string;
  lunar: string;
  solar: string;
  remaining: string;
}

/** Giới hạn độ dài để tên rất dài không tràn khung ảnh; chú thích đi kèm vẫn có tên đầy đủ. */
export function cardData({ event, occurrence, daysBefore }: ReminderItem): CardData {
  return {
    name: clip(event.fullName, 45),
    relationship: clip(event.relationship, 24),
    family: clip(event.familyName ?? '', 40),
    lunar: formatLunarLabel(occurrence),
    solar: formatDateVN(occurrence.solarDate),
    remaining: remainingLabel(daysBefore),
  };
}

/** Phần thay đổi theo từng ngày giỗ. */
function cardMarkup(item: ReminderItem): string {
  const data = cardData(item);
  const name = escapeHtml(data.name);
  const person = data.relationship ? `${name} <small>(${escapeHtml(data.relationship)})</small>` : name;

  return `<div class="title"><svg viewBox="0 0 24 24"><path d="M12 2a2 2 0 0 1 2 2v.600c3.500.900 5.500 4 5.500 7.400 0 3.500 1 5 2.500 6.500v1H2v-1c1.500-1.500 2.500-3 2.500-6.500 0-3.400 2-6.500 5.500-7.400V4a2 2 0 0 1 2-2zm-2.500 19h5a2.500 2.500 0 0 1-5 0z"/></svg>Nhắc Ngày Giỗ Gia Đình</div>
<div class="panel">
${row('person', 'Người mất:', person)}
${data.family ? row('home', 'Gia đình:', escapeHtml(data.family)) : ''}
${row('calendar', 'Ngày giỗ âm:', escapeHtml(data.lunar))}
${row('calendar', 'Ngày dương:', escapeHtml(data.solar))}
${row('hourglass', 'Còn lại:', `<span class="pill">${escapeHtml(data.remaining)}</span>`, false)}
</div>`;
}

/** HTML tự chứa nền và font (data URI), không tải gì qua mạng nên chụp nhanh và ổn định. */
export function renderCardHtml(item: ReminderItem, _baseUrl?: string): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<style>${CARD_FONT_CSS}
${CARD_STYLE}</style></head><body>
<img class="photo" src="${CARD_BACKGROUND}" alt="">
<div class="sun"></div>
<svg class="hills" viewBox="0 0 820 190" preserveAspectRatio="none"><path d="M0 190C120 110 200 150 300 100s150 10 240-30 170 20 280-20v140z"/></svg>
${cardMarkup(item)}
<script>${FIT_SCRIPT}</script></body></html>`;
}

/**
 * Khóa nhận ra ảnh đã có: băm phiên bản mẫu và nội dung, không băm hàng trăm KB ảnh nền và font.
 * Sửa mẫu thiệp trên Vercel (relay/lib/card.ts) thì tăng CARD_DESIGN_VERSION để không dùng lại ảnh cũ.
 */
export function cardContentKey(item: ReminderItem): Promise<string> {
  return sha256Hex(`${CARD_DESIGN_VERSION}\n${ASSET_VERSION}\n${CARD_STYLE}\n${FIT_SCRIPT}\n${JSON.stringify(cardData(item))}`);
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
  /** Số ảnh tối đa tạo bằng Browser Run mỗi lượt (mặc định MAX_RENDERS_PER_RUN). Webhook đặt thấp để trả lời kịp. */
  maxRenders?: number;
  /** Số lần thử lại mỗi ảnh khi lỗi tạm thời (Vercel) hoặc bị 429 (Browser Run). Webhook đặt 0 để trả lời kịp. */
  retries?: number;
}

/** Dịch vụ vẽ ảnh trên Vercel (relay/api/card.ts): nhanh, không giới hạn tốc độ. Là cách chính khi đã cấu hình. */
export function isCardServiceConfigured(env: Env): boolean {
  return Boolean(env.CARD_RENDER_URL && env.CARD_RENDER_SECRET);
}

/** Cloudflare Browser Run: chậm và chỉ 1 ảnh mỗi 20 giây, dùng dự phòng khi Vercel lỗi hoặc chưa cấu hình. */
export function isBrowserRunConfigured(env: Env): boolean {
  return Boolean(env.BROWSER_RUN_TOKEN && (env.BROWSER_RUN_ACCOUNT_ID || env.BROWSER_RUN_ENDPOINT));
}

export function isCardConfigured(env: Env): boolean {
  return Boolean(env.PUBLIC_BASE_URL && (isCardServiceConfigured(env) || isBrowserRunConfigured(env)));
}

export class CardRenderError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Thời gian Cloudflare yêu cầu chờ (header Retry-After), nếu có. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }

  /** Hết 10 phút trình duyệt của ngày (đến 0h UTC) hoặc sai token: thử lại vô ích. */
  get fatal(): boolean {
    return this.status === 401 || this.status === 403 || /time limit exceeded/i.test(this.message);
  }

  /** Bị giới hạn tốc độ, hết thời gian hoặc lỗi phía máy chủ: chờ rồi thử lại có thể được. */
  get retryable(): boolean {
    return !this.fatal && (this.status === 429 || this.status === 408 || this.status >= 500 || this.status < 400);
  }
}

function parseRetryAfter(value: string | null): number | null {
  const seconds = Number(value);
  return value && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/** Nhờ dịch vụ trên Vercel vẽ thiệp thành ảnh JPEG. Lỗi có thông báo rõ nhưng không chứa secret. */
export async function renderCardViaService(env: Env, item: ReminderItem, doFetch: typeof fetch = (i, init) => fetch(i, init)): Promise<ArrayBuffer> {
  const res = await doFetch(env.CARD_RENDER_URL!, {
    method: 'POST',
    headers: { 'x-card-secret': env.CARD_RENDER_SECRET!, 'content-type': 'application/json' },
    body: JSON.stringify(cardData(item)),
    signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
  });
  if (res.ok && (res.headers.get('content-type') ?? '').startsWith('image/')) return res.arrayBuffer();
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new CardRenderError(res.status, body?.error ?? `HTTP ${res.status}`);
}

/** Chụp HTML thành ảnh JPEG bằng Browser Run. Lỗi có thông báo rõ nhưng không chứa token. */
export async function renderCardImage(env: Env, html: string, doFetch: typeof fetch = (i, init) => fetch(i, init)): Promise<ArrayBuffer> {
  const endpoint =
    env.BROWSER_RUN_ENDPOINT ?? `https://api.cloudflare.com/client/v4/accounts/${env.BROWSER_RUN_ACCOUNT_ID}/browser-rendering/screenshot`;
  const res = await doFetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.BROWSER_RUN_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      html,
      viewport: VIEWPORT,
      screenshotOptions: { type: 'jpeg', quality: 88 },
      // Trang không tải gì qua mạng; chờ script báo font đã nạp và chữ đã căn xong.
      gotoOptions: { waitUntil: 'load', timeout: 20_000 },
      waitForSelector: { selector: 'html[data-ready]', timeout: 8_000 },
    }),
  });
  if (res.ok && (res.headers.get('content-type') ?? '').startsWith('image/')) return res.arrayBuffer();
  const body = (await res.json().catch(() => null)) as { errors?: { message?: string }[] } | null;
  throw new CardRenderError(res.status, body?.errors?.[0]?.message ?? `HTTP ${res.status}`, parseRetryAfter(res.headers.get('retry-after')));
}

function errorReason(err: unknown): string {
  return `${err instanceof CardRenderError ? `HTTP ${err.status}: ` : ''}${err instanceof Error ? err.message : String(err)}`;
}

/** Tạo một ảnh, ưu tiên Vercel rồi tới Browser Run; dùng cho nút xem thử. Cả hai đều lỗi thì ném lỗi cuối cùng. */
export async function renderCardOnce(env: Env, item: ReminderItem): Promise<ArrayBuffer> {
  let lastError: unknown = new Error('Chưa cấu hình cách tạo ảnh thiệp');
  if (isCardServiceConfigured(env)) {
    try {
      return await renderCardViaService(env, item);
    } catch (err) {
      lastError = err;
      console.warn(`Dịch vụ vẽ thiệp lỗi (${errorReason(err)}), chuyển sang Browser Run`);
    }
  }
  if (isBrowserRunConfigured(env)) return renderCardImage(env, renderCardHtml(item));
  throw lastError;
}

/**
 * Trả về null nếu chưa cấu hình. Ưu tiên dịch vụ Vercel; Vercel lỗi thì dùng Browser Run, cả hai lỗi thì trả null để gửi bằng chữ.
 * Cùng nội dung thiệp thì dùng lại ảnh đã có, nên gửi cho nhiều chat hay chạy lại đều không tốn thêm lượt tạo ảnh.
 */
export function createCardProvider(env: Env, options: CardOptions = {}): CardProvider | null {
  if (!isCardConfigured(env)) return null;
  const baseUrl = env.PUBLIC_BASE_URL!.replace(/\/+$/, '');
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const maxRenders = options.maxRenders ?? MAX_RENDERS_PER_RUN;
  const retries = options.retries ?? DEFAULT_RETRIES;

  let serviceRenders = 0;
  /** Vercel lỗi hẳn (sai secret, sập) thì các ảnh sau của lượt này đi thẳng sang Browser Run, không chờ thêm. */
  let serviceDown = !isCardServiceConfigured(env);

  let browserRenders = 0;
  /** Lúc lần gọi Browser Run trước kết thúc; null nếu chưa gọi lần nào trong lượt này. */
  let lastDoneAt: number | null = null;
  let browserStopped = !isBrowserRunConfigured(env);

  async function viaService(item: ReminderItem): Promise<ArrayBuffer | null> {
    if (serviceDown || serviceRenders >= MAX_SERVICE_RENDERS_PER_RUN) return null;
    serviceRenders++;
    for (let attempt = 0; ; attempt++) {
      try {
        return await renderCardViaService(env, item, options.fetch);
      } catch (err) {
        const renderError = err instanceof CardRenderError ? err : null;
        // Sai secret hoặc Vercel chưa cấu hình: thử lại vô ích.
        const misconfigured = renderError !== null && [401, 403, 404, 503].includes(renderError.status);
        if (!misconfigured && (renderError ? renderError.retryable : true) && attempt < retries) {
          console.warn(`Dịch vụ vẽ thiệp lỗi (${errorReason(err)}), thử lại lần ${attempt + 1}/${retries}`);
          await sleep(SERVICE_RETRY_DELAY_MS);
          continue;
        }
        serviceDown = true;
        console.warn(`Dịch vụ vẽ thiệp lỗi (${errorReason(err)}), chuyển sang Browser Run`);
        return null;
      }
    }
  }

  async function browserRunOnce(html: string, extraWait: number): Promise<ArrayBuffer> {
    const wait = Math.max(lastDoneAt === null ? 0 : lastDoneAt + MIN_RENDER_GAP_MS - now(), extraWait);
    if (wait > 0) await sleep(wait);
    try {
      return await renderCardImage(env, html, options.fetch);
    } finally {
      lastDoneAt = now();
    }
  }

  async function viaBrowserRun(item: ReminderItem): Promise<ArrayBuffer | null> {
    if (browserStopped || browserRenders >= maxRenders) return null;
    browserRenders++;
    const html = renderCardHtml(item);
    let extraWait = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        return await browserRunOnce(html, extraWait);
      } catch (err) {
        const renderError = err instanceof CardRenderError ? err : null;
        const retryAfter = renderError?.retryAfterMs ?? 0;
        if ((renderError ? renderError.retryable : true) && attempt < retries && retryAfter <= MAX_RETRY_WAIT_MS) {
          console.warn(`Tạo ảnh thiệp lỗi (${errorReason(err)}), thử lại lần ${attempt + 1}/${retries}`);
          extraWait = retryAfter;
          continue;
        }
        // Hết hạn mức, sai token hay vẫn bị 429 sau khi đã chờ thì các ảnh sau cũng lỗi: dừng hẳn cho lượt này.
        if (renderError && (renderError.fatal || renderError.status === 429)) browserStopped = true;
        console.warn(`Không tạo được ảnh thiệp, sẽ gửi bằng chữ: ${errorReason(err)}`);
        return null;
      }
    }
  }

  return {
    async imageUrlFor(item) {
      const hash = await cardContentKey(item);
      const existing = await findCardToken(env.DB, hash);
      if (existing) return `${baseUrl}/cards/${existing}.jpg`;
      const image = (await viaService(item)) ?? (await viaBrowserRun(item));
      if (!image) return null;
      const token = randomToken();
      await saveCard(env.DB, token, hash, image);
      return `${baseUrl}/cards/${(await findCardToken(env.DB, hash)) ?? token}.jpg`;
    },
  };
}
