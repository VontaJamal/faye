export interface RoundTripStatusResponse {
  sessionId: string;
  pending: boolean;
  state: "wake_detected" | "awaiting_speak" | "speak_received" | null;
  retryCount: number;
  updatedAt: string | null;
}

export async function fetchRoundTripStatus(sessionId: string): Promise<RoundTripStatusResponse> {
  const response = await fetch(`/v1/roundtrip/${encodeURIComponent(sessionId)}/status`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  return (await response.json()) as RoundTripStatusResponse;
}
