// Every external call: timeout + retry with exponential backoff (CLAUDE.md, "Fallos esperados").

export interface RetryOptions {
  attempts?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Whether a request that may already have reached the server can be repeated safely.
   * Defaults to true for GET/HEAD only. Non-idempotent requests are retried only on 429
   * (not processed), never after a timeout or 5xx (it may have been processed, e.g. a duplicate alert).
   */
  idempotent?: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Max honored Retry-After, so a cron run never stalls for long. */
export const MAX_RETRY_AFTER_MS = 30_000;

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  return undefined;
}

export async function fetchWithRetry(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  { attempts = 3, timeoutMs = 10_000, baseDelayMs = 500, sleep = defaultSleep, idempotent }: RetryOptions = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const safeToRepeat = idempotent ?? (method === "GET" || method === "HEAD");
  let lastError: unknown;
  let retryAfterMs: number | undefined;
  for (let i = 0; i < attempts; i++) {
    // Keep the caller's signal (cancellation) and add our timeout.
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      const res = await fetchFn(url, { ...init, signal });
      // 4xx other than 429 will not get better by retrying.
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      if (res.status !== 429 && !safeToRepeat) return res;
      lastError = new HttpError(res.status, `HTTP ${res.status} from ${new URL(url).host}`);
      retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      // Free the connection: unread bodies keep it open in the Workers runtime.
      await res.body?.cancel();
    } catch (err) {
      if (init.signal?.aborted || !safeToRepeat) throw err;
      lastError = err;
    }
    if (i < attempts - 1) await sleep(Math.max(baseDelayMs * 2 ** i, retryAfterMs ?? 0));
    retryAfterMs = undefined;
  }
  throw lastError;
}

/** Timeout + retry with backoff for non-HTTP calls (e.g. KV), which have no timeout of their own. */
export async function retryAsync<T>(
  op: () => Promise<T>,
  { attempts = 3, timeoutMs = 5_000, baseDelayMs = 200, sleep = defaultSleep }: RetryOptions = {},
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        op(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
        }),
      ]);
    } catch (err) {
      lastError = err;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    if (i < attempts - 1) await sleep(baseDelayMs * 2 ** i);
  }
  throw lastError;
}
