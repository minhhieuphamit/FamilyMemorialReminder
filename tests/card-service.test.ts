import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../relay/api/card';
import { parseCardData } from '../relay/lib/card';
import { cardData, createCardProvider, isCardConfigured } from '../src/services/card-image';
import type { ReminderItem } from '../src/services/message-format';
import type { Env } from '../src/types/env';
import { createTestDb } from './helpers/fake-d1';
import { makeEvent } from './helpers/factories';

const occurrence = { solarDate: '2026-11-14', lunarDay: 6, lunarMonth: 10, lunarYear: 2026, isLeapMonth: false, adjustment: 'none' as const };
const item = (over: Partial<ReminderItem> = {}): ReminderItem => ({
  event: makeEvent({ fullName: 'Phạm Quốc Huy', relationship: '', familyName: 'Phạm Văn Phát - Nguyễn Thị Hoa' }),
  occurrence,
  daysBefore: 1,
  ...over,
});
const SERVICE = 'https://relay.test/api/card';
const BROWSER = 'https://browser.test/screenshot';
const jpeg = () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } });
const failing = (status: number) => new Response(JSON.stringify({ error: 'x' }), { status, headers: { 'content-type': 'application/json' } });

describe('Dữ liệu thiệp gửi sang Vercel', () => {
  it('đủ các dòng in trên thiệp', () => {
    expect(cardData(item())).toEqual({
      name: 'Phạm Quốc Huy',
      relationship: '',
      family: 'Phạm Văn Phát - Nguyễn Thị Hoa',
      lunar: '06/10',
      solar: '14/11/2026',
      remaining: 'Ngày mai',
    });
  });

  it('tên quá dài được rút gọn trước khi gửi', () => {
    const data = cardData(item({ event: makeEvent({ fullName: 'A'.repeat(120), relationship: 'B'.repeat(60), familyName: 'C'.repeat(60) }) }));
    expect(data.name.length).toBeLessThanOrEqual(45);
    expect(data.relationship.length).toBeLessThanOrEqual(24);
    expect(data.family.length).toBeLessThanOrEqual(40);
  });
});

describe('Tạo ảnh: Vercel trước, Browser Run dự phòng', () => {
  let env: Env;
  let raw: ReturnType<typeof createTestDb>['raw'];
  let calls: { url: string; headers: Record<string, string>; body: unknown }[];

  const provider = (handler: (url: string) => Response | Promise<Response>, over: Partial<Env> = {}, retries?: number) =>
    createCardProvider(
      { ...env, ...over },
      {
        retries,
        sleep: async () => {},
        fetch: (async (url: string, init: RequestInit) => {
          calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
          return handler(url);
        }) as unknown as typeof fetch,
      },
    )!;

  beforeEach(() => {
    const test = createTestDb();
    raw = test.raw;
    calls = [];
    env = {
      DB: test.db,
      ASSETS: {} as Fetcher,
      PUBLIC_BASE_URL: 'https://gio.example',
      CARD_RENDER_URL: SERVICE,
      CARD_RENDER_SECRET: 'card-secret',
      BROWSER_RUN_ENDPOINT: BROWSER,
      BROWSER_RUN_TOKEN: 'browser-token',
    };
  });

  it('chỉ cần Vercel là bật được ảnh thiệp', () => {
    expect(isCardConfigured({ ...env, BROWSER_RUN_ENDPOINT: undefined, BROWSER_RUN_TOKEN: undefined })).toBe(true);
    expect(isCardConfigured({ ...env, CARD_RENDER_SECRET: undefined, BROWSER_RUN_TOKEN: undefined })).toBe(false);
  });

  it('gọi Vercel với secret và dữ liệu thiệp, không cần chờ giữa các ảnh', async () => {
    const waits: number[] = [];
    const cards = createCardProvider(env, {
      sleep: async (ms) => void waits.push(ms),
      fetch: (async (url: string, init: RequestInit) => (calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) }), jpeg())) as unknown as typeof fetch,
    })!;
    const urls = [await cards.imageUrlFor(item()), await cards.imageUrlFor(item({ daysBefore: 0 }))];
    expect(urls.every((u) => /^https:\/\/gio\.example\/cards\/[0-9a-f]{64}\.jpg$/.test(u ?? ''))).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([SERVICE, SERVICE]);
    expect(calls[0].headers['x-card-secret']).toBe('card-secret');
    expect(calls[0].body).toEqual(cardData(item()));
    expect(waits).toEqual([]);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM card_images').get()).toEqual({ n: 2 });
  });

  it('Vercel lỗi tạm thời thì thử lại', async () => {
    let n = 0;
    const cards = provider(() => (++n === 1 ? failing(502) : jpeg()));
    expect(await cards.imageUrlFor(item())).not.toBeNull();
    expect(calls.map((c) => c.url)).toEqual([SERVICE, SERVICE]);
  });

  it('Vercel hỏng hẳn thì dùng Browser Run, các ảnh sau đi thẳng Browser Run', async () => {
    const cards = provider((url) => (url === SERVICE ? failing(500) : jpeg()), {}, 1);
    expect(await cards.imageUrlFor(item())).not.toBeNull();
    expect(await cards.imageUrlFor(item({ daysBefore: 0 }))).not.toBeNull();
    expect(calls.map((c) => c.url)).toEqual([SERVICE, SERVICE, BROWSER, BROWSER]);
  });

  it.each([[401], [503]])('Vercel trả %i (sai hoặc thiếu secret) thì không thử lại, chuyển Browser Run', async (status) => {
    const cards = provider((url) => (url === SERVICE ? failing(status) : jpeg()));
    expect(await cards.imageUrlFor(item())).not.toBeNull();
    expect(calls.map((c) => c.url)).toEqual([SERVICE, BROWSER]);
  });

  it('chưa cấu hình Vercel thì dùng Browser Run như trước', async () => {
    const cards = provider(() => jpeg(), { CARD_RENDER_URL: undefined, CARD_RENDER_SECRET: undefined });
    expect(await cards.imageUrlFor(item())).not.toBeNull();
    expect(calls.map((c) => c.url)).toEqual([BROWSER]);
  });

  it('cả hai đều lỗi thì trả null để gửi bằng chữ', async () => {
    const cards = provider(() => failing(500), { BROWSER_RUN_ENDPOINT: undefined, BROWSER_RUN_TOKEN: undefined }, 0);
    expect(await cards.imageUrlFor(item())).toBeNull();
    expect(raw.prepare('SELECT COUNT(*) AS n FROM card_images').get()).toEqual({ n: 0 });
  });
});

/** Đọc kích thước ảnh từ khung SOF của JPEG. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  for (let i = 2; i + 9 < bytes.length; ) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xc3) return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    i += 2 + length;
  }
  return null;
}

describe('Hàm vẽ thiệp trên Vercel', () => {
  const request = (body: unknown, secret?: string) =>
    new Request('https://relay.test/api/card', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(secret ? { 'x-card-secret': secret } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const data = cardData(item());

  beforeEach(() => vi.stubEnv('CARD_RENDER_SECRET', 'card-secret'));
  afterEach(() => vi.unstubAllEnvs());

  it('chưa đặt secret trên Vercel thì báo 503', async () => {
    vi.stubEnv('CARD_RENDER_SECRET', '');
    expect((await POST(request(data, 'card-secret'))).status).toBe(503);
  });

  it.each([[undefined], ['sai']])('secret %s bị từ chối', async (secret) => {
    expect((await POST(request(data, secret))).status).toBe(401);
  });

  it('dữ liệu sai hoặc quá lớn bị từ chối', async () => {
    expect((await POST(request('không phải json', 'card-secret'))).status).toBe(400);
    expect((await POST(request({ ...data, name: '' }, 'card-secret'))).status).toBe(400);
    expect((await POST(request({ ...data, name: 'x'.repeat(5000) }, 'card-secret'))).status).toBe(413);
  });

  it('chỉ nhận chuỗi, cắt bớt chuỗi quá dài', () => {
    expect(parseCardData({ ...data, family: 42 })?.family).toBe('');
    expect(parseCardData({ ...data, name: 'A'.repeat(200) })?.name).toHaveLength(80);
    expect(parseCardData(null)).toBeNull();
  });

  it('vẽ ra ảnh JPEG khổ 1200x800 có tiếng Việt', async () => {
    const res = await POST(request({ ...data, relationship: 'Bà cố ngoại', lunar: '06/10 nhuận' }, 'card-secret'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(jpegSize(bytes)).toEqual({ width: 1200, height: 800 });
  }, 30_000);
});
