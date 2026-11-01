/**
 * Phần gọi API dùng chung cho Telegram và Zalo Bot: hai bên cùng dạng
 * POST <gốc>/bot<token>/<method>, trả về { ok, result, error_code, description }.
 * Có retry và không bao giờ để lộ token trong lỗi.
 */

export class BotApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Lượt cron sau có được gửi lại không. false với lỗi vĩnh viễn như bot bị chặn hoặc chat không tồn tại. */
    readonly retryable: boolean,
    /** Lỗi tạm thời đáng thử lại ngay trong lượt gọi này. */
    readonly transient: boolean = retryable,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'BotApiError';
  }
}

export interface BotApiOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Số lần thử lại sau lần gọi đầu tiên. */
  retries?: number;
}

export interface BotApiConfig extends BotApiOptions {
  baseUrl: string;
  token: string;
  classify: (code: number) => { retryable: boolean; transient: boolean };
}

const MAX_RETRY_AFTER_SECONDS = 10;

export function createBotApi(config: BotApiConfig) {
  const doFetch = config.fetch ?? ((input, init) => fetch(input, init));
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retries = config.retries ?? 2;
  const sanitize = (message: string) => message.split(config.token).join('<token>');

  async function callOnce<T>(method: string, payload: unknown): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${config.baseUrl}/bot${config.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      });
    } catch (err) {
      throw new BotApiError(`Lỗi mạng: ${sanitize(String(err))}`, 0, true);
    }
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
      error_code?: number;
      description?: string;
      parameters?: { retry_after?: number };
    } | null;
    if (res.ok && data?.ok) return data.result as T;

    // Lỗi có thể nằm trong HTTP status hoặc trong error_code của HTTP 200.
    const code = data?.error_code ?? res.status;
    const { retryable, transient } = config.classify(code);
    throw new BotApiError(sanitize(data?.description ?? `HTTP ${code}`), code, retryable, transient, data?.parameters?.retry_after);
  }

  return async function call<T>(method: string, payload?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await callOnce<T>(method, payload);
      } catch (err) {
        const apiError = err as BotApiError;
        if (!apiError.transient || attempt >= retries) throw apiError;
        // retry_after quá dài thì để lượt cron sau xử lý, tránh giữ Worker lâu.
        if (apiError.retryAfter && apiError.retryAfter > MAX_RETRY_AFTER_SECONDS) throw apiError;
        await sleep(apiError.retryAfter ? apiError.retryAfter * 1000 : 500 * 3 ** attempt);
      }
    }
  };
}
