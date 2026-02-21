import type {
  ConversationContextMessage,
  ConversationContextResponse,
  ConversationSessionSnapshot,
  DashboardState,
  HealthResponse
} from "../state/store.js";

function formatTimestamp(value?: string | null): string {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return date.toLocaleString();
}

function appendEmptyState(container: HTMLElement, text: string): void {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.textContent = text;
  container.append(div);
}

function formatConversationState(state: ConversationSessionSnapshot["state"]): string {
  if (state === "awaiting_assistant") {
    return "Waiting for assistant response";
  }
  if (state === "agent_responding") {
    return "Assistant response in progress";
  }
  if (state === "ended") {
    return "Ended";
  }
  return "Waiting for your next message";
}

function conversationBadge(label: string, value: string, state: "good" | "warn" | "bad" = "warn"): HTMLElement {
  const badge = document.createElement("span");
  badge.className = `conversation-badge ${state}`;
  badge.textContent = `${label}: ${value}`;
  return badge;
}

function contextMeta(message: ConversationContextMessage, displayCode: (code: string) => string): string {
  const role = message.role.toUpperCase();
  const at = formatTimestamp(message.at);
  const turn = typeof message.turn === "number" ? ` · turn ${message.turn}` : "";
  const status = message.status ? ` · ${displayCode(message.status)}` : "";
  const action = message.action ? ` · ${displayCode(message.action)}` : "";
  const code = message.code ? ` · ${displayCode(message.code)}` : "";
  return `${role} · ${at}${turn}${status}${action}${code}`;
}

export async function refreshConversationContext(
  state: DashboardState,
  sessionId: string | null,
  apiRequest: <T>(url: string, init?: RequestInit) => Promise<T>,
  displayCode: (code: string) => string
): Promise<void> {
  const conversationContext = state.elements.conversationContext;
  if (!conversationContext) {
    return;
  }

  conversationContext.innerHTML = "";
  if (!sessionId) {
    appendEmptyState(conversationContext, "Live context appears when a conversation session is available.");
    return;
  }

  try {
    const response = await apiRequest<ConversationContextResponse>(
      `/v1/conversation/${encodeURIComponent(sessionId)}/context?limit=8&includePending=true`
    );
    if (response.context.messages.length === 0) {
      appendEmptyState(conversationContext, "No context messages retained yet.");
      return;
    }

    for (const message of response.context.messages) {
      const item = document.createElement("li");
      item.className = `conversation-context-item ${message.role}`;

      const meta = document.createElement("p");
      meta.className = "conversation-context-meta";
      meta.textContent = contextMeta(message, displayCode);

      const text = document.createElement("p");
      text.className = "conversation-context-text";
      text.textContent = message.text;

      item.append(meta, text);
      conversationContext.append(item);
    }
  } catch {
    appendEmptyState(conversationContext, "Context endpoint unavailable. Refresh health and retry.");
  }
}

export function renderConversationPanel(
  state: DashboardState,
  health: HealthResponse,
  apiRequest: <T>(url: string, init?: RequestInit) => Promise<T>,
  displayCode: (code: string) => string
): void {
  const conversationState = state.elements.conversationState;
  const conversationBadges = state.elements.conversationBadges;
  const conversationTurns = state.elements.conversationTurns;
  const conversationContext = state.elements.conversationContext;
  const conversationEnd = state.elements.conversationEnd;

  if (!conversationState || !conversationBadges || !conversationTurns || !conversationContext || !conversationEnd) {
    return;
  }

  conversationState.innerHTML = "";
  conversationBadges.innerHTML = "";
  conversationTurns.innerHTML = "";
  conversationContext.innerHTML = "";
  state.activeConversationSessionId = null;

  const snapshot = health.conversation;
  if (!snapshot) {
    appendEmptyState(conversationState, "Conversation state is not available yet.");
    appendEmptyState(conversationContext, "Live context is not available yet.");
    conversationEnd.disabled = true;
    return;
  }

  const active =
    snapshot.sessions.find(
      (session) => typeof snapshot.activeSessionId === "string" && session.sessionId === snapshot.activeSessionId
    ) ??
    snapshot.sessions.find((session) => session.state !== "ended") ??
    snapshot.sessions[0] ??
    null;

  const headline = document.createElement("div");
  headline.className = "conversation-headline";
  headline.innerHTML = [
    `Active sessions: <strong>${snapshot.activeSessions}</strong>`,
    `Retained sessions: <strong>${snapshot.retainedSessions}</strong>`,
    `Policy: <strong>${snapshot.policy.turnPolicy.baseTurns}+${snapshot.policy.turnPolicy.extendBy}</strong> up to <strong>${snapshot.policy.turnPolicy.hardCap}</strong> turns`,
    `Context TTL: <strong>${Math.round(snapshot.policy.ttlMs / 60000)} min</strong>`,
    `Last end reason: <strong>${snapshot.lastEndReason ? displayCode(snapshot.lastEndReason) : "n/a"}</strong>`
  ]
    .map((line) => `<p>${line}</p>`)
    .join("");
  conversationState.append(headline);

  if (!active) {
    appendEmptyState(conversationTurns, "No active conversation yet. Trigger wake word to begin.");
    appendEmptyState(conversationContext, "Live context appears after the first retained message.");
    conversationEnd.disabled = true;
    return;
  }

  state.activeConversationSessionId = active.state === "ended" ? null : active.sessionId;
  const statusCard = document.createElement("div");
  statusCard.className = `conversation-status-card ${active.state === "ended" ? "ended" : "active"}`;
  statusCard.innerHTML = [
    `<p><strong>Session</strong>: ${active.sessionId}</p>`,
    `<p><strong>Status</strong>: ${formatConversationState(active.state)}</p>`,
    `<p><strong>Turn progress</strong>: ${active.totalTurns}/${active.turnLimit}</p>`,
    `<p><strong>Retained turns</strong>: ${active.retainedTurns}</p>`,
    `<p><strong>Last turn</strong>: ${formatTimestamp(active.lastTurnAt)}</p>`,
    `<p><strong>Expires</strong>: ${formatTimestamp(active.expiresAt)} (${Math.ceil(active.expiresInMs / 1000)}s)</p>`,
    active.endReason ? `<p><strong>End reason</strong>: ${displayCode(active.endReason)}</p>` : ""
  ].join("");
  conversationState.append(statusCard);

  const ttlState = active.expiresInMs <= 30_000 ? "bad" : active.expiresInMs <= 120_000 ? "warn" : "good";
  const stateBadgeState =
    active.state === "ended"
      ? "bad"
      : active.state === "awaiting_assistant" || active.state === "agent_responding"
        ? "warn"
        : "good";

  conversationBadges.append(
    conversationBadge("State", active.state, stateBadgeState),
    conversationBadge("Turn", `${active.totalTurns}/${active.turnLimit}`, "warn"),
    conversationBadge("TTL", `${Math.ceil(active.expiresInMs / 1000)}s`, ttlState),
    conversationBadge(
      "Stop Requested",
      active.stopRequested || snapshot.stopRequested ? "yes" : "no",
      active.stopRequested || snapshot.stopRequested ? "warn" : "good"
    )
  );

  if (active.endReason) {
    conversationBadges.append(conversationBadge("End Reason", displayCode(active.endReason), "bad"));
  }

  const retainedTurns = active.turns.slice(-6);
  if (retainedTurns.length === 0) {
    appendEmptyState(conversationTurns, "No retained turns yet.");
  } else {
    for (const turn of retainedTurns) {
      const item = document.createElement("li");
      item.className = "conversation-turn";
      item.innerHTML = [
        `<p class=\"conversation-turn-title\">Turn ${turn.turn}</p>`,
        `<p><strong>You</strong>: ${turn.userText ?? "n/a"}</p>`,
        `<p><strong>Agent</strong>: ${turn.assistantText ?? "pending"}</p>`,
        `<p><strong>Agent status</strong>: ${turn.assistantStatus ? displayCode(turn.assistantStatus) : "n/a"}</p>`
      ].join("");
      conversationTurns.append(item);
    }
  }

  conversationEnd.disabled = state.activeConversationSessionId === null;
  void refreshConversationContext(state, active.sessionId, apiRequest, displayCode);
}
