export const DEFAULT_WATCHDOG_MS = 12_000;
export const DEFAULT_RETRY_LIMIT = 1;
export const STALE_SESSION_MS = 180_000;

export function toSessionId(payload: Record<string, unknown>): string | null {
  const value = payload.session_id ?? payload.sessionId;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toText(payload: Record<string, unknown>): string | undefined {
  const value = payload.text;
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function toSpokenStatus(payload: Record<string, unknown>): "ok" | "error" | "duplicate" | null {
  const status = payload.status;
  if (status === "ok" || status === "error" || status === "duplicate") {
    return status;
  }
  return null;
}

export function formatIso(ms: number): string {
  return new Date(ms).toISOString();
}

export async function sendTelegram(botToken: string, chatId: number, text: string): Promise<void> {
  const payload = new URLSearchParams();
  payload.set("chat_id", String(chatId));
  payload.set("text", text);

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: payload.toString()
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 200);
    throw new Error(`E_TELEGRAM_SEND_${response.status}:${body}`);
  }
}
