/**
 * Chuyển tiếp webhook Zalo sang Worker. Cloudflare chặn User-Agent Java/1.8 của Zalo trên workers.dev (lỗi 1010),
 * nên Zalo gọi địa chỉ này và relay gọi lại Worker. Worker vẫn tự kiểm tra secret; relay không lưu hay ghi log tin nhắn.
 */
const TARGET_URL = 'https://family-memorial-reminder.minhhieupham2002.workers.dev/zalo/webhook';
const SECRET_HEADER = 'x-bot-api-secret-token';
const TIMEOUT_MS = 25_000;

const jsonError = (error: string, status: number) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });

export async function POST(request: Request): Promise<Response> {
  const secret = request.headers.get(SECRET_HEADER);
  if (!secret) return jsonError('Không có quyền', 401);
  try {
    const upstream = await fetch(TARGET_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'family-memorial-zalo-relay/1.0', [SECRET_HEADER]: secret },
      body: await request.text(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return new Response(await upstream.text(), { status: upstream.status, headers: { 'content-type': 'application/json' } });
  } catch {
    return jsonError('Không gọi được Worker', 502);
  }
}
