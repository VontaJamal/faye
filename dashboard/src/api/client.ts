export interface RoundTripStatusResponse {
  sessionId: string;
  pending: boolean;
  state: "wake_detected" | "awaiting_speak" | "speak_received" | null;
  retryCount: number;
  updatedAt: string | null;
}

export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    if (text) {
      try {
        const parsed = JSON.parse(text) as { error?: string; issues?: Array<{ path?: string; message?: string }> };
        if (parsed.error === "E_VALIDATION" && Array.isArray(parsed.issues) && parsed.issues.length > 0) {
          const message = parsed.issues
            .map((item) => `${item.path ?? "field"}: ${item.message ?? "invalid"}`)
            .join("; ");
          throw new Error(message);
        }
        if (parsed.error) {
          throw new Error(parsed.error);
        }
      } catch (error) {
        if (error instanceof Error && error.message.length > 0 && error.message !== text) {
          throw error;
        }
        throw new Error(text);
      }
    }
    throw new Error(`HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function fetchRoundTripStatus(sessionId: string): Promise<RoundTripStatusResponse> {
  return apiRequest<RoundTripStatusResponse>(`/v1/roundtrip/${encodeURIComponent(sessionId)}/status`);
}
