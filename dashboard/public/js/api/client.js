export async function fetchRoundTripStatus(sessionId) {
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
    return (await response.json());
}
