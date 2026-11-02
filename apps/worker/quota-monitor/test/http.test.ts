import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry, MAX_RETRY_AFTER_MS, parseRetryAfter } from "../../shared/http";

const opts = { attempts: 3, baseDelayMs: 1, sleep: vi.fn(async () => {}) };

describe("fetchWithRetry", () => {
  it("retries 5xx with backoff and returns the first success", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 502 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const res = await fetchWithRetry(fetchFn, "https://example.com", {}, opts);
    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not retry 4xx other than 429", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("", { status: 403 }));
    const res = await fetchWithRetry(fetchFn, "https://example.com", {}, opts);
    expect(res.status).toBe(403);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting attempts", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(fetchWithRetry(fetchFn, "https://example.com", {}, opts)).rejects.toThrow("timeout");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("honors Retry-After (capped) and cancels discarded bodies", async () => {
    const sleep = vi.fn(async () => {});
    const throttled = new Response("slow down", { status: 429, headers: { "retry-after": "5" } });
    const cancel = vi.spyOn(throttled.body!, "cancel");
    const fetchFn = vi.fn().mockResolvedValueOnce(throttled).mockResolvedValueOnce(new Response("ok"));
    await fetchWithRetry(fetchFn, "https://example.com", {}, { attempts: 2, baseDelayMs: 1, sleep });
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(cancel).toHaveBeenCalled();
  });

  it("parseRetryAfter caps long waits and ignores HTTP dates", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter("3600")).toBe(MAX_RETRY_AFTER_MS);
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it("passes a timeout signal", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("ok"));
    await fetchWithRetry(fetchFn, "https://example.com", {}, opts);
    expect(fetchFn.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });

  it("does not repeat a POST after a timeout or 5xx (may have been processed), but retries 429", async () => {
    const post = { method: "POST" };
    const five = vi.fn().mockResolvedValue(new Response("", { status: 502 }));
    expect((await fetchWithRetry(five, "https://example.com", post, opts)).status).toBe(502);
    expect(five).toHaveBeenCalledTimes(1);

    const timeout = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(fetchWithRetry(timeout, "https://example.com", post, opts)).rejects.toThrow("timeout");
    expect(timeout).toHaveBeenCalledTimes(1);

    const throttled = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(new Response("ok"));
    expect((await fetchWithRetry(throttled, "https://example.com", post, opts)).status).toBe(200);

    const idem = vi.fn().mockResolvedValueOnce(new Response("", { status: 502 })).mockResolvedValueOnce(new Response("ok"));
    expect((await fetchWithRetry(idem, "https://example.com", post, { ...opts, idempotent: true })).status).toBe(200);
  });

  it("keeps the caller's abort signal", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const fetchFn = vi.fn(async (_u: string, init: RequestInit) => {
      if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return new Response("ok");
    });
    await expect(fetchWithRetry(fetchFn as unknown as typeof fetch, "https://example.com", { signal: ctrl.signal }, opts)).rejects.toThrow("aborted");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
