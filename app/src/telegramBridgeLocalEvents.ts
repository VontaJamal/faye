import { DEFAULT_API_BASE_URL, LOCAL_EVENT_TOKEN_PATH } from "./paths";
import { pathExists, readSecret } from "./utils";

let localEventTokenCache: string | undefined;

async function readLocalEventToken(): Promise<string | null> {
  if (typeof localEventTokenCache === "string" && localEventTokenCache.length > 0) {
    return localEventTokenCache;
  }

  if (!(await pathExists(LOCAL_EVENT_TOKEN_PATH))) {
    return null;
  }

  try {
    const token = await readSecret(LOCAL_EVENT_TOKEN_PATH);
    if (!token) {
      return null;
    }
    localEventTokenCache = token;
    return token;
  } catch {
    return null;
  }
}

export async function emitLocalEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
  const token = await readLocalEventToken();
  if (!token) {
    return;
  }

  const response = await fetch(`${DEFAULT_API_BASE_URL}/v1/internal/listener-event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-faye-local-token": token
    },
    body: JSON.stringify({
      type: eventType,
      payload
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`E_LOCAL_EVENT_${response.status}: ${text.slice(0, 180)}`);
  }
}
