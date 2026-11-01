const encoder = new TextEncoder();

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** So sánh hai chuỗi trong thời gian không phụ thuộc nội dung (băm trước để cân độ dài). */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < hashA.length; i++) diff |= hashA.charCodeAt(i) ^ hashB.charCodeAt(i);
  return diff === 0;
}

// Workers giới hạn PBKDF2 tối đa 100.000 vòng.
const PBKDF2_ITERATIONS = 100_000;

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2(password: string, saltHex: string, iterations: number): Promise<string> {
  const salt = Uint8Array.from(saltHex.match(/../g) ?? [], (h) => parseInt(h, 16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toHex(new Uint8Array(bits));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${await pbkdf2(password, salt, PBKDF2_ITERATIONS)}`;
}

/** Không có hash thì vẫn tính một lần để thời gian phản hồi không lộ tài khoản có tồn tại hay không. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [, iterations, salt, hash] = (stored ?? `pbkdf2$${PBKDF2_ITERATIONS}$${'0'.repeat(32)}$`).split('$');
  const actual = await pbkdf2(password, salt, Number(iterations));
  return (await constantTimeEqual(actual, hash)) && stored !== null;
}

export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}
