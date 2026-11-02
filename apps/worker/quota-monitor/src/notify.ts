// Alert channel. Telegram is optional until the bot exists; without it alerts only go to logs
// and Cloudflare's own Budget Alert / Billable Usage notification remain the safety net.
import { fetchWithRetry, type RetryOptions } from "../../shared/http";

export interface Notifier {
  send(text: string): Promise<void>;
}

export class LogNotifier implements Notifier {
  async send(text: string): Promise<void> {
    console.log(`[quota-monitor] ${text}`);
  }
}

export class TelegramNotifier implements Notifier {
  constructor(
    private readonly fetchFn: typeof fetch,
    private readonly botToken: string,
    private readonly chatId: string,
    private readonly retry?: RetryOptions,
  ) {}

  async send(text: string): Promise<void> {
    const res = await fetchWithRetry(
      this.fetchFn,
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: this.chatId, text }),
      },
      this.retry,
    );
    if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
  }
}
