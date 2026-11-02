// quota-monitor: hourly Cron Trigger that keeps R2 inside the internal budget.
// Publishes the guard state in KV (key GUARD_KEY); upload/ingest Workers (F13) must read it
// and refuse new uploads at `stop_uploads` and any R2 access at `stop_all`.
import { fetchR2Usage } from "./cloudflare";
import { retryAsync, type RetryOptions } from "../../shared/http";
import { LogNotifier, TelegramNotifier, type Notifier } from "./notify";
import { evaluate, severity, type Evaluation, type Level } from "./usage";

export const GUARD_KEY = "r2-guard";

/**
 * Consumers (upload/ingest Workers, F13) must treat a guard whose `okAt` (last successful usage
 * read) is older than this as `stop_uploads`. The monitor applies the same rule itself, so a
 * broken usage read never leaves uploads running unmonitored for longer than this.
 */
export const GUARD_MAX_AGE_MS = 3 * 3600 * 1000;
export const STALE_AFTER_MS = GUARD_MAX_AGE_MS;
export interface Env {
  GUARD: KVNamespace;
  CF_ACCOUNT_ID: string;
  CF_ANALYTICS_TOKEN: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

export interface GuardState {
  level: Level;
  checkedAt: string;
  /** Last time usage was read successfully. */
  okAt: string | null;
  budgetUsed: Evaluation["budgetUsed"] | null;
  error?: string;
}

export interface Deps {
  fetchFn: typeof fetch;
  now: () => Date;
  notifier?: Notifier;
  retry?: RetryOptions;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

function notifierFor(env: Env, deps: Deps): Notifier {
  if (deps.notifier) return deps.notifier;
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    return new TelegramNotifier(deps.fetchFn, env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, deps.retry);
  }
  return new LogNotifier();
}

export async function runCheck(env: Env, deps: Deps): Promise<GuardState> {
  const now = deps.now();
  const notifier = notifierFor(env, deps);
  const kvErrors: string[] = [];
  // undefined = KV read failed (previous level unknown); null = no previous state.
  let previous: GuardState | null | undefined;
  try {
    previous = await retryAsync(() => env.GUARD.get<GuardState>(GUARD_KEY, "json"), deps.retry);
  } catch (err) {
    kvErrors.push(`KV read: ${errMsg(err)}`);
  }
  const prevLevel: Level | "unknown" = previous === undefined ? "unknown" : (previous?.level ?? "ok");

  let next: GuardState;
  try {
    const usage = await fetchR2Usage(deps.fetchFn, env.CF_ACCOUNT_ID, env.CF_ANALYTICS_TOKEN, now, deps.retry);
    const ev = evaluate(usage);
    next = { level: ev.level, checkedAt: now.toISOString(), okAt: now.toISOString(), budgetUsed: ev.budgetUsed };
  } catch (err) {
    // Never relax the guard on an error. With neither usage nor the previous level known,
    // assume the worst (stop_all). Otherwise fail closed once usage has been unknown too long.
    let level: Level;
    if (prevLevel === "unknown") {
      level = "stop_all";
    } else {
      const okAt = previous?.okAt ?? null;
      const stale = !okAt || now.getTime() - Date.parse(okAt) > STALE_AFTER_MS;
      level = stale && severity(prevLevel) < severity("stop_uploads") ? "stop_uploads" : prevLevel;
    }
    next = {
      level,
      checkedAt: now.toISOString(),
      okAt: previous?.okAt ?? null,
      budgetUsed: previous?.budgetUsed ?? null,
      error: errMsg(err),
    };
  }

  try {
    await retryAsync(() => env.GUARD.put(GUARD_KEY, JSON.stringify(next)), deps.retry);
  } catch (err) {
    kvErrors.push(`KV write: ${errMsg(err)}`);
  }

  if (kvErrors.length) {
    // Consumers treat a stale `okAt` as stop_uploads, so a stuck flag fails closed;
    // still, the owner must know right away.
    await safeNotify(notifier, `R2 guard: KV failure, flag may be stale (${kvErrors.join("; ")}) | ${describe(next, prevLevel)}`);
    return next;
  }

  const changed = next.level !== prevLevel;
  const firstErrorHour = next.error && !previous?.error;
  if (changed || firstErrorHour || (severity(next.level) > 0 && now.getUTCHours() === 12)) {
    await safeNotify(notifier, describe(next, prevLevel));
  }
  return next;
}

export function describe(state: GuardState, prevLevel: Level | "unknown"): string {
  const head = state.level === prevLevel ? `R2 guard: ${state.level}` : `R2 guard: ${prevLevel} -> ${state.level}`;
  const used = state.budgetUsed
    ? ` | budget used: storage ${pct(state.budgetUsed.storage)}, class A ${pct(state.budgetUsed.classA)}, class B ${pct(state.budgetUsed.classB)}`
    : "";
  const err = state.error ? ` | usage read failed: ${state.error}` : "";
  return head + used + err;
}

async function safeNotify(notifier: Notifier, text: string): Promise<void> {
  try {
    await notifier.send(text);
  } catch (err) {
    // Fallback channel: logs (visible in the Workers dashboard).
    console.error(`[quota-monitor] notify failed (${String(err)}): ${text}`);
  }
}

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    try {
      await runCheck(env, { fetchFn: fetch, now: () => new Date() });
    } catch (err) {
      console.error(`[quota-monitor] check crashed: ${errMsg(err)}`);
    }
  },
} satisfies ExportedHandler<Env>;
