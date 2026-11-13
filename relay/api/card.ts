/**
 * Tạo ảnh thiệp nhắc ngày giỗ cho Worker. Worker gửi dữ liệu thiệp kèm secret, nhận lại ảnh JPEG rồi tự lưu và phục vụ ảnh;
 * hàm này không lưu hay ghi log dữ liệu nào. Secret đặt ở biến môi trường CARD_RENDER_SECRET của Vercel, trùng với secret của Worker.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { parseCardData, renderCard } from '../lib/card.js';

const SECRET_HEADER = 'x-card-secret';
const MAX_BODY = 4096;

const jsonError = (error: string, status: number) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });

const digest = (value: string) => createHash('sha256').update(value).digest();

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.CARD_RENDER_SECRET;
  if (!expected) return jsonError('Chưa cấu hình CARD_RENDER_SECRET', 503);
  if (!timingSafeEqual(digest(request.headers.get(SECRET_HEADER) ?? ''), digest(expected))) return jsonError('Không có quyền', 401);

  const text = await request.text();
  if (text.length > MAX_BODY) return jsonError('Dữ liệu quá lớn', 413);
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Xử lý bên dưới như dữ liệu sai.
  }
  const data = parseCardData(body);
  if (!data) return jsonError('Dữ liệu thiệp không hợp lệ', 400);

  try {
    const image = await renderCard(data);
    return new Response(new Uint8Array(image), { status: 200, headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } });
  } catch (err) {
    console.error(`Không vẽ được thiệp: ${err instanceof Error ? err.message : String(err)}`);
    return jsonError('Không vẽ được thiệp', 500);
  }
}
