import { describe, expect, it, vi } from "vitest";
import { GRAPHQL_URL } from "../src/cloudflare";
import { GUARD_KEY, runCheck, STALE_AFTER_MS, type Env, type GuardState } from "../src/index";
import type { Notifier } from "../src/notify";
import { FREE_TIER } from "../src/usage";

class MemoryKV {
  store = new Map<string, string>();
  async get(key: string, type?: string) {
    const v = this.store.get(key);
    if (v === undefined) return null;
    return type === "json" ? JSON.parse(v) : v;
  }
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
}

function makeEnv(kv = new MemoryKV()): Env & { GUARD: MemoryKV } {
  return {
    GUARD: kv as unknown as KVNamespace & MemoryKV,
    CF_ACCOUNT_ID: "0".repeat(32),
    CF_ANALYTICS_TOKEN: "test-token",
  } as Env & { GUARD: MemoryKV };
}

function graphqlResponse(opts: { classB?: number; storageBytes?: number }) {
  return new Response(
    JSON.stringify({
      data: {
        viewer: {
          accounts: [
            {
              ops: [{ sum: { requests: opts.classB ?? 0 }, dimensions: { actionType: "GetObject" } }],
              storage: [{ max: { payloadSize: opts.storageBytes ?? 0, metadataSize: 0 }, dimensions: { bucketName: "b" } }],
            },
          ],
        },
      },
      errors: null,
    }),
    { status: 200 },
  );
}

const noRetry = { attempts: 1, sleep: async () => {} };
const NOW = new Date("2026-11-01T10:17:00Z");

function recorder(): Notifier & { messages: string[] } {
  const messages: string[] = [];
  return { messages, send: async (t: string) => void messages.push(t) };
}

describe("runCheck", () => {
  it("writes ok state and stays quiet when usage is low", async () => {
    const env = makeEnv();
    const notifier = recorder();
    const fetchFn = vi.fn(async () => graphqlResponse({ classB: 10 }));
    const state = await runCheck(env, { fetchFn: fetchFn as unknown as typeof fetch, now: () => NOW, notifier, retry: noRetry });

    expect(state.level).toBe("ok");
    expect(JSON.parse(env.GUARD.store.get(GUARD_KEY)!).level).toBe("ok");
    expect(notifier.messages).toHaveLength(0);
    expect(fetchFn).toHaveBeenCalledWith(GRAPHQL_URL, expect.objectContaining({ method: "POST" }));
  });

  it("alerts at 70% and activates the kill switch at 90% of the budget", async () => {
    const env = makeEnv();
    const notifier = recorder();
    const at = (fraction: number) =>
      runCheck(env, {
        fetchFn: (async () => graphqlResponse({ storageBytes: FREE_TIER.storageBytes * 0.5 * fraction })) as unknown as typeof fetch,
        now: () => NOW,
        notifier,
        retry: noRetry,
      });

    expect((await at(0.7)).level).toBe("warn");
    expect(notifier.messages.at(-1)).toContain("ok -> warn");

    expect((await at(0.9)).level).toBe("stop_uploads");
    expect(notifier.messages.at(-1)).toContain("warn -> stop_uploads");
    expect(JSON.parse(env.GUARD.store.get(GUARD_KEY)!).level).toBe("stop_uploads");
  });

  it("never relaxes the guard when the API fails", async () => {
    const kv = new MemoryKV();
    const prev: GuardState = {
      level: "stop_uploads",
      checkedAt: NOW.toISOString(),
      okAt: NOW.toISOString(),
      budgetUsed: { storage: 0.9, classA: 0, classB: 0 },
    };
    kv.store.set(GUARD_KEY, JSON.stringify(prev));
    const env = makeEnv(kv);
    const notifier = recorder();
    const state = await runCheck(env, {
      fetchFn: (async () => new Response("boom", { status: 503 })) as unknown as typeof fetch,
      now: () => new Date(NOW.getTime() + 3600_000),
      notifier,
      retry: noRetry,
    });
    expect(state.level).toBe("stop_uploads");
    expect(state.error).toContain("503");
    expect(notifier.messages[0]).toContain("usage read failed");
  });

  it("fails closed (stop_uploads) if usage has been unknown for too long", async () => {
    const kv = new MemoryKV();
    kv.store.set(
      GUARD_KEY,
      JSON.stringify({ level: "ok", checkedAt: NOW.toISOString(), okAt: NOW.toISOString(), budgetUsed: null }),
    );
    const env = makeEnv(kv);
    const state = await runCheck(env, {
      fetchFn: (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
      now: () => new Date(NOW.getTime() + STALE_AFTER_MS + 1),
      notifier: recorder(),
      retry: noRetry,
    });
    expect(state.level).toBe("stop_uploads");
  });

  it("treats GraphQL errors as a failed read", async () => {
    const env = makeEnv();
    const state = await runCheck(env, {
      fetchFn: (async () =>
        new Response(JSON.stringify({ data: null, errors: [{ message: "not authorized" }] }), {
          status: 200,
        })) as unknown as typeof fetch,
      now: () => NOW,
      notifier: recorder(),
      retry: noRetry,
    });
    expect(state.error).toContain("not authorized");
    // No previous successful read at all: fail closed.
    expect(state.level).toBe("stop_uploads");
  });

  it("alerts when KV fails instead of failing silently", async () => {
    const brokenKV = {
      get: async () => {
        throw new Error("kv read down");
      },
      put: async () => {
        throw new Error("kv write down");
      },
    };
    const env = { ...makeEnv(), GUARD: brokenKV as unknown as KVNamespace } as Env;
    const notifier = recorder();
    const state = await runCheck(env, {
      fetchFn: (async () => graphqlResponse({ classB: 1 })) as unknown as typeof fetch,
      now: () => NOW,
      notifier,
      retry: noRetry,
    });
    expect(state.level).toBe("ok");
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0]).toContain("KV read: kv read down");
    expect(notifier.messages[0]).toContain("KV write: kv write down");
  });

  it("never lowers stop_all when both the KV read and the usage read fail", async () => {
    const kv = new MemoryKV();
    kv.store.set(GUARD_KEY, JSON.stringify({ level: "stop_all", checkedAt: NOW.toISOString(), okAt: NOW.toISOString(), budgetUsed: null }));
    let reads = 0;
    const flakyKV = {
      get: async () => {
        reads++;
        throw new Error("kv read down");
      },
      put: (k: string, v: string) => kv.put(k, v),
    };
    const env = { ...makeEnv(), GUARD: flakyKV as unknown as KVNamespace } as Env;
    const notifier = recorder();
    const state = await runCheck(env, {
      fetchFn: (async () => new Response("boom", { status: 503 })) as unknown as typeof fetch,
      now: () => NOW,
      notifier,
      retry: { attempts: 2, sleep: async () => {} },
    });
    expect(reads).toBe(2); // KV calls are retried too
    expect(state.level).toBe("stop_all");
    expect(JSON.parse(kv.store.get(GUARD_KEY)!).level).toBe("stop_all");
    expect(notifier.messages[0]).toContain("unknown -> stop_all");
  });

  it("fails closed within GUARD_MAX_AGE_MS, not days", async () => {
    expect(STALE_AFTER_MS).toBeLessThanOrEqual(3 * 3600 * 1000);
  });

  it("a failing notifier does not break the check", async () => {
    const env = makeEnv();
    const state = await runCheck(env, {
      fetchFn: (async () => graphqlResponse({ storageBytes: FREE_TIER.storageBytes })) as unknown as typeof fetch,
      now: () => NOW,
      notifier: { send: async () => Promise.reject(new Error("telegram down")) },
      retry: noRetry,
    });
    expect(state.level).toBe("stop_all");
  });
});
