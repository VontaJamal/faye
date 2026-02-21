export async function telegramRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`E_TELEGRAM_HTTP_${response.status}: ${text.slice(0, 180)}`);
    }
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function callLocalApi(pathname: string, body?: unknown): Promise<void> {
  const response = await fetch(`http://127.0.0.1:4587${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`E_LOCAL_API_${response.status}: ${text.slice(0, 180)}`);
  }
}

export async function fetchLocalJson<T>(pathname: string): Promise<T> {
  const response = await fetch(`http://127.0.0.1:4587${pathname}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`E_LOCAL_API_${response.status}: ${text.slice(0, 180)}`);
  }

  return (await response.json()) as T;
}

export async function sendTelegram(botToken: string, chatId: number, text: string): Promise<void> {
  const payload = new URLSearchParams();
  payload.set("chat_id", String(chatId));
  payload.set("text", text);

  await telegramRequest<{ ok: boolean }>(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: payload.toString()
  });
}
