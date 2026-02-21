interface Profile {
  id: string;
  name: string;
  voiceId: string;
  voiceName: string;
  wakeWord: string;
}

interface ProfilesResponse {
  activeProfileId: string;
  profiles: Profile[];
}

interface BridgeRuntimeStatus {
  state: "starting" | "idle" | "processing" | "error";
  updatedAt: string;
  consecutiveErrors: number;
  backoffMs: number;
  lastErrorAt?: string;
  lastError?: string;
  lastSuccessAt?: string;
  lastOffset?: number;
  lastUpdateId?: number;
  lastCommandType?: string;
  lastCommandStatus?: "ok" | "error" | "duplicate";
}

interface RoundTripSnapshot {
  watchdogMs: number;
  autoRetryLimit: number;
  activeSessions: number;
  pendingSessions: Array<{
    sessionId: string;
    state: "wake_detected" | "awaiting_speak" | "speak_received";
    retryCount: number;
    ageMs: number;
    updatedAt: string;
  }>;
  totals: {
    started: number;
    retriesSent: number;
    completed: number;
    timeouts: number;
  };
  lastCompleted:
    | {
        sessionId: string;
        at: string;
        retryCount: number;
        status: "ok" | "error" | "duplicate";
      }
    | null;
  lastTimeout:
    | {
        sessionId: string;
        at: string;
        retryCount: number;
        reason: "watchdog" | "retry_send_failed" | "retry_unavailable";
      }
    | null;
}

interface MetricsSnapshot {
  generatedAt: string;
  eventCounts: {
    wakeDetections: number;
    messageTranscribed: number;
    listenerErrors: number;
    bridgeSpeakReceived: number;
  };
  roundTrip: {
    bridgeSpokenOk: number;
    bridgeSpokenError: number;
    bridgeSpokenDuplicate: number;
    retriesSent: number;
    timeouts: number;
    activeTrackedSessions: number;
  };
  latency: {
    samples: number;
    lastMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    maxMs: number | null;
  };
  errorRate: {
    numerator: number;
    denominator: number;
    value: number | null;
  };
}

interface ConversationTurnSnapshot {
  turn: number;
  userText: string | null;
  userAt: string | null;
  assistantText: string | null;
  assistantAt: string | null;
  assistantStatus: "ok" | "error" | "duplicate" | "pending" | null;
}

interface ConversationSessionSnapshot {
  sessionId: string;
  state: "awaiting_user" | "awaiting_assistant" | "agent_responding" | "ended";
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  expiresInMs: number;
  endReason?: string;
  totalTurns: number;
  retainedTurns: number;
  turnLimit: number;
  extensionsUsed: number;
  lastTurnAt: string | null;
  stopRequested: boolean;
  turns: ConversationTurnSnapshot[];
}

interface ConversationSnapshot {
  policy: {
    ttlMs: number;
    maxTurnsRetainedPerSession: number;
    maxSessions: number;
    turnPolicy: {
      baseTurns: number;
      extendBy: number;
      hardCap: number;
    };
  };
  activeSessions: number;
  retainedSessions: number;
  activeSessionId?: string | null;
  activeTurn?: number | null;
  lastTurnAt?: string | null;
  lastEndReason?: string | null;
  stopRequested?: boolean;
  endReasons: Record<string, number>;
  sessions: ConversationSessionSnapshot[];
}

interface ConversationContextMessage {
  role: "user" | "assistant" | "system";
  text: string;
  at: string;
  turn?: number;
  status?: string;
  action?: string;
  code?: string;
}

interface ConversationContext {
  sessionId: string;
  state: ConversationSessionSnapshot["state"];
  expiresAt: string;
  expiresInMs: number;
  turnPolicy: {
    baseTurns: number;
    extendBy: number;
    hardCap: number;
  };
  turnProgress: {
    current: number;
    limit: number;
    remaining: number;
  };
  endReason?: string;
  lastTurnAt: string | null;
  stopRequested: boolean;
  messages: ConversationContextMessage[];
}

interface ConversationContextResponse {
  context: ConversationContext;
}

interface ServiceStatusResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface OnboardingChecklistItem {
  id: string;
  label: string;
  ok: boolean;
  message: string;
}

interface OnboardingSummary {
  checklist: {
    bridgeRequired: boolean;
    completed: number;
    total: number;
    items: OnboardingChecklistItem[];
  };
  firstSetupAt: string | null;
  firstVoiceSuccessAt: string | null;
  timeToFirstSuccessMs: number | null;
  lastVoiceTestAt: string | null;
  lastVoiceTestOk: boolean | null;
}

interface SystemRecoveryServiceResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface SystemRecoveryResult {
  schemaVersion: 1;
  action: "panic-stop" | "factory-reset";
  requestedAt: string;
  completedAt: string;
  confirmationMatched: boolean;
  endedSessionId: string | null;
  stopRequestWritten: boolean;
  dashboardKeptRunning: boolean;
  archivePath: string | null;
  clearedRuntimeFiles: string[];
  wipedPaths: string[];
  stoppedServices: {
    listener?: SystemRecoveryServiceResult;
    bridge?: SystemRecoveryServiceResult;
    dashboard?: SystemRecoveryServiceResult;
  };
  notes: string[];
  errors: string[];
}

interface SystemRecoveryResponse {
  ok: boolean;
  result: SystemRecoveryResult;
}

interface HealthResponse {
  ok: boolean;
  doctor?: {
    ok?: boolean;
  };
  services?: {
    listener?: ServiceStatusResult;
    dashboard?: ServiceStatusResult;
    bridge?: ServiceStatusResult;
  };
  bridgeRuntime: BridgeRuntimeStatus | null;
  roundTrip?: RoundTripSnapshot;
  metrics?: MetricsSnapshot;
  conversation?: ConversationSnapshot;
  onboarding?: OnboardingSummary;
}

interface StreamEvent {
  id: string;
  type: string;
  time: string;
  payload: Record<string, unknown>;
}

type SetupFieldName =
  | "profileName"
  | "apiKey"
  | "voiceId"
  | "voiceName"
  | "wakeWord"
  | "telegramToken"
  | "telegramChatId";

interface SetupPayload {
  profileName: string;
  apiKey?: string;
  voiceId: string;
  voiceName: string;
  wakeWord: string;
  telegramToken?: string;
  telegramChatId?: string;
}

const FIELD_MAX: Record<SetupFieldName, number> = {
  profileName: 80,
  apiKey: 300,
  voiceId: 128,
  voiceName: 128,
  wakeWord: 120,
  telegramToken: 300,
  telegramChatId: 64
};

const PANIC_STOP_CONFIRMATION = "PANIC STOP";
const FACTORY_RESET_CONFIRMATION = "FACTORY RESET";

const DEBUG_MODE = new URLSearchParams(window.location.search).get("debug") === "1";

const EVENT_LABELS: Record<string, string> = {
  wake_detected: "Wake Word Heard",
  wake_variant_learned: "Wake Phrase Learned",
  message_transcribed: "Voice Captured",
  listener_error: "Listener Issue",
  listener_status: "Listener Update",
  conversation_turn_started: "Conversation Turn Started",
  conversation_turn_completed: "Conversation Turn Completed",
  bridge_speak_received: "Agent Reply Received",
  bridge_spoken: "Agent Reply Played",
  bridge_action_requested: "Action Requested",
  bridge_action_executed: "Action Completed",
  bridge_action_blocked: "Action Needs Confirmation",
  system_panic_stop_requested: "Panic Stop Requested",
  system_panic_stop_completed: "Panic Stop Completed",
  system_factory_reset_requested: "Factory Reset Requested",
  system_factory_reset_completed: "Factory Reset Completed"
};

const setupStatus = document.querySelector<HTMLParagraphElement>("#setup-status");
const setupValidationSummary = document.querySelector<HTMLDivElement>("#setup-validation-summary");
const profileList = document.querySelector<HTMLDivElement>("#profile-list");
const healthPre = document.querySelector<HTMLPreElement>("#health");
const eventsList = document.querySelector<HTMLUListElement>("#events");
const runtimeStatus = document.querySelector<HTMLDivElement>("#runtime-status");
const serviceSummary = document.querySelector<HTMLDivElement>("#service-summary");
const firstSuccessChecklist = document.querySelector<HTMLDivElement>("#first-success-checklist");
const conversationState = document.querySelector<HTMLDivElement>("#conversation-state");
const conversationBadges = document.querySelector<HTMLDivElement>("#conversation-badges");
const conversationTurns = document.querySelector<HTMLUListElement>("#conversation-turns");
const conversationContext = document.querySelector<HTMLUListElement>("#conversation-context");
const conversationEnd = document.querySelector<HTMLButtonElement>("#conversation-end");
const panicConfirmationInput = document.querySelector<HTMLInputElement>("#panic-confirmation");
const factoryResetConfirmationInput = document.querySelector<HTMLInputElement>("#factory-reset-confirmation");
const panicStopButton = document.querySelector<HTMLButtonElement>("#panic-stop-button");
const factoryResetButton = document.querySelector<HTMLButtonElement>("#factory-reset-button");
const recoveryStatus = document.querySelector<HTMLParagraphElement>("#recovery-status");

let latestHealth: HealthResponse | null = null;
let activeConversationSessionId: string | null = null;

function setStatus(message: string, error = false): void {
  if (!setupStatus) {
    return;
  }
  setupStatus.textContent = message;
  setupStatus.classList.toggle("error", error);
}

function setRecoveryStatus(message: string, error = false): void {
  if (!recoveryStatus) {
    return;
  }
  recoveryStatus.textContent = message;
  recoveryStatus.classList.toggle("error", error);
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
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

function optionalField(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : undefined;
}

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

function formatDuration(valueMs: number | null): string {
  if (valueMs === null) {
    return "n/a";
  }
  const minutes = valueMs / 60_000;
  return `${minutes.toFixed(1)} min`;
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function appendEmptyState(container: HTMLElement, text: string): void {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.textContent = text;
  container.append(div);
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function humanizeCode(code: string): string {
  return code
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function displayCode(code: string): string {
  return DEBUG_MODE ? code : humanizeCode(code);
}

function eventTitle(type: string): string {
  if (DEBUG_MODE) {
    return type;
  }
  return EVENT_LABELS[type] ?? displayCode(type);
}

function listenerStatusSummary(status: string): string {
  const map: Record<string, string> = {
    started: "Listener started and is waiting for your wake phrase.",
    conversation_loop_started: "Conversation session started.",
    conversation_loop_extended: "Conversation session extended with extra turns.",
    conversation_loop_ended: "Conversation session ended."
  };
  return map[status] ?? `Listener status: ${displayCode(status)}.`;
}

function eventSummary(event: StreamEvent): string {
  const payload = asObject(event.payload) ?? {};
  switch (event.type) {
    case "wake_detected": {
      const heard = asNonEmptyString(payload.heard);
      const wakeWord = asNonEmptyString(payload.wake_word);
      if (heard && wakeWord) {
        return `Heard "${heard}" and matched wake phrase "${wakeWord}".`;
      }
      if (heard) {
        return `Heard "${heard}" and started listening.`;
      }
      return "Wake phrase matched. Faye is listening.";
    }
    case "wake_variant_learned": {
      const variant = asNonEmptyString(payload.variant);
      const wakeWord = asNonEmptyString(payload.wake_word);
      if (variant && wakeWord) {
        return `Learned "${variant}" as an alternate phrase for "${wakeWord}".`;
      }
      if (variant) {
        return `Learned "${variant}" as an alternate wake phrase.`;
      }
      return "Learned a new alternate wake phrase.";
    }
    case "message_transcribed": {
      const text = asNonEmptyString(payload.text);
      const turn = asFiniteNumber(payload.turn);
      const turnPart = turn !== null ? ` (turn ${turn})` : "";
      if (text) {
        return `Captured your speech${turnPart}: "${text}".`;
      }
      return `Captured your speech${turnPart}.`;
    }
    case "listener_error": {
      const code = asNonEmptyString(payload.code);
      const status = asFiniteNumber(payload.status);
      if (code && status !== null) {
        return `Listener error ${code} (status ${status}).`;
      }
      if (code) {
        return `Listener error ${code}.`;
      }
      return "Listener encountered an error.";
    }
    case "listener_status": {
      const status = asNonEmptyString(payload.status);
      if (status) {
        return listenerStatusSummary(status);
      }
      return "Listener status updated.";
    }
    case "conversation_turn_started": {
      const turn = asFiniteNumber(payload.turn);
      return turn !== null ? `Started conversation turn ${turn}.` : "Started a conversation turn.";
    }
    case "conversation_turn_completed": {
      const turn = asFiniteNumber(payload.turn);
      const waitResult = asNonEmptyString(payload.wait_result);
      if (turn !== null && waitResult) {
        return `Completed turn ${turn} with result "${displayCode(waitResult)}".`;
      }
      if (turn !== null) {
        return `Completed turn ${turn}.`;
      }
      return "Completed a conversation turn.";
    }
    case "bridge_speak_received": {
      return "Agent response was received and queued for voice playback.";
    }
    case "bridge_spoken": {
      const status = asNonEmptyString(payload.status);
      if (status) {
        return `Agent voice reply finished with status "${displayCode(status)}".`;
      }
      return "Agent voice reply was played.";
    }
    case "bridge_action_requested": {
      const name = asNonEmptyString(payload.name);
      return name ? `Requested action "${displayCode(name)}".` : "Requested an action.";
    }
    case "bridge_action_executed": {
      const name = asNonEmptyString(payload.name);
      return name ? `Completed action "${displayCode(name)}".` : "Completed an action.";
    }
    case "bridge_action_blocked": {
      const name = asNonEmptyString(payload.name);
      return name
        ? `Action "${displayCode(name)}" is waiting for confirmation.`
        : "Action is waiting for confirmation.";
    }
    case "system_panic_stop_requested":
      return "Panic Stop requested. Listener and bridge are being halted.";
    case "system_panic_stop_completed": {
      const ok = payload.ok === true;
      return ok
        ? "Panic Stop completed. You can restart services when ready."
        : "Panic Stop completed with warnings. Check status before continuing.";
    }
    case "system_factory_reset_requested":
      return "Factory Reset requested. Preparing archive and clean reset.";
    case "system_factory_reset_completed": {
      const ok = payload.ok === true;
      return ok
        ? "Factory Reset completed. Start install flow again from scratch."
        : "Factory Reset completed with warnings. Review recovery status.";
    }
    default:
      return "Activity updated.";
  }
}

function makeChip(label: string, value: string, state: "good" | "warn" | "bad" = "warn"): HTMLElement {
  const chip = document.createElement("span");
  chip.className = `status-chip ${state}`;
  chip.textContent = `${label}: ${value}`;
  return chip;
}

function classifyService(result?: ServiceStatusResult): "good" | "bad" {
  return result?.code === 0 ? "good" : "bad";
}

function classifyErrorRate(value: number | null): "good" | "warn" | "bad" {
  if (value === null) {
    return "warn";
  }
  if (value <= 0.02) {
    return "good";
  }
  if (value <= 0.06) {
    return "warn";
  }
  return "bad";
}

function classifyLatency(value: number | null): "good" | "warn" | "bad" {
  if (value === null) {
    return "warn";
  }
  if (value <= 2500) {
    return "good";
  }
  if (value <= 5000) {
    return "warn";
  }
  return "bad";
}

function itemFromOnboarding(health: HealthResponse | null, itemId: string): OnboardingChecklistItem | null {
  const items = health?.onboarding?.checklist.items ?? [];
  return items.find((item) => item.id === itemId) ?? null;
}

function apiKeyReadyForActiveProfile(): boolean {
  return itemFromOnboarding(latestHealth, "api-key-ready")?.ok === true;
}

function renderServiceSummary(health: HealthResponse): void {
  if (!serviceSummary) {
    return;
  }

  serviceSummary.innerHTML = "";
  const listener = health.services?.listener;
  const dashboard = health.services?.dashboard;
  const bridge = health.services?.bridge;
  const checklist = health.onboarding?.checklist;

  serviceSummary.append(
    makeChip("Doctor", health.doctor?.ok === true ? "ok" : "attention", health.doctor?.ok === true ? "good" : "bad"),
    makeChip("Listener", listener?.code === 0 ? "running" : "down", classifyService(listener)),
    makeChip("Dashboard", dashboard?.code === 0 ? "running" : "down", classifyService(dashboard)),
    makeChip("Bridge", bridge?.code === 0 ? "running" : "down", classifyService(bridge)),
    makeChip(
      "p95",
      health.metrics?.latency.p95Ms === null || health.metrics?.latency.p95Ms === undefined
        ? "n/a"
        : `${health.metrics.latency.p95Ms}ms`,
      classifyLatency(health.metrics?.latency.p95Ms ?? null)
    ),
    makeChip(
      "Error Rate",
      formatPercent(health.metrics?.errorRate.value ?? null),
      classifyErrorRate(health.metrics?.errorRate.value ?? null)
    )
  );

  if (checklist) {
    serviceSummary.append(
      makeChip(
        "First Success",
        `${checklist.completed}/${checklist.total}`,
        checklist.completed === checklist.total ? "good" : "warn"
      )
    );
  }
}

function renderRuntimeCell(label: string, value: string): HTMLElement {
  const item = document.createElement("div");
  item.className = "runtime-item";

  const title = document.createElement("strong");
  title.textContent = label;

  const content = document.createElement("span");
  content.textContent = value;

  item.append(title, content);
  return item;
}

function renderRuntimeStatus(runtime: BridgeRuntimeStatus | null, roundTrip?: RoundTripSnapshot, metrics?: MetricsSnapshot): void {
  if (!runtimeStatus) {
    return;
  }

  runtimeStatus.classList.remove("pulse");
  runtimeStatus.innerHTML = "";

  if (!runtime) {
    appendEmptyState(runtimeStatus, "No bridge runtime data yet.");
    return;
  }

  runtimeStatus.append(
    renderRuntimeCell("Bridge State", runtime.state),
    renderRuntimeCell("Consecutive Errors", String(runtime.consecutiveErrors)),
    renderRuntimeCell("Backoff", `${runtime.backoffMs}ms`),
    renderRuntimeCell("Last Update", typeof runtime.lastUpdateId === "number" ? String(runtime.lastUpdateId) : "n/a"),
    renderRuntimeCell("Last Offset", typeof runtime.lastOffset === "number" ? String(runtime.lastOffset) : "n/a"),
    renderRuntimeCell(
      "Last Command",
      runtime.lastCommandType ? `${runtime.lastCommandType} (${runtime.lastCommandStatus ?? "unknown"})` : "n/a"
    ),
    renderRuntimeCell("Last Success", formatTimestamp(runtime.lastSuccessAt)),
    renderRuntimeCell(
      "Last Error",
      runtime.lastError ? `${formatTimestamp(runtime.lastErrorAt)} | ${runtime.lastError}` : "n/a"
    )
  );

  if (roundTrip) {
    const lastCompleted = roundTrip.lastCompleted
      ? `${roundTrip.lastCompleted.status} @ ${formatTimestamp(roundTrip.lastCompleted.at)}`
      : "n/a";
    const lastTimeout = roundTrip.lastTimeout
      ? `${roundTrip.lastTimeout.reason} @ ${formatTimestamp(roundTrip.lastTimeout.at)}`
      : "n/a";

    runtimeStatus.append(
      renderRuntimeCell("Round-Trip Active", String(roundTrip.activeSessions)),
      renderRuntimeCell("Round-Trip Retries", String(roundTrip.totals.retriesSent)),
      renderRuntimeCell("Round-Trip Timeouts", String(roundTrip.totals.timeouts)),
      renderRuntimeCell("Round-Trip Completed", String(roundTrip.totals.completed)),
      renderRuntimeCell("Round-Trip Last Completed", lastCompleted),
      renderRuntimeCell("Round-Trip Last Timeout", lastTimeout)
    );
  }

  if (metrics) {
    runtimeStatus.append(
      renderRuntimeCell("Wake Detections", String(metrics.eventCounts.wakeDetections)),
      renderRuntimeCell("Spoken OK", String(metrics.roundTrip.bridgeSpokenOk)),
      renderRuntimeCell("p95 Latency", metrics.latency.p95Ms === null ? "n/a" : `${metrics.latency.p95Ms}ms`),
      renderRuntimeCell("Error Rate", formatPercent(metrics.errorRate.value))
    );
  }

  requestAnimationFrame(() => runtimeStatus.classList.add("pulse"));
}

function renderFirstSuccessChecklist(health: HealthResponse): void {
  if (!firstSuccessChecklist) {
    return;
  }

  firstSuccessChecklist.innerHTML = "";
  const onboarding = health.onboarding;
  if (!onboarding) {
    appendEmptyState(firstSuccessChecklist, "Checklist data not available yet.");
    return;
  }

  const progress = document.createElement("p");
  progress.className = "checklist-progress";
  progress.textContent = `Progress: ${onboarding.checklist.completed}/${onboarding.checklist.total}`;

  const goal = document.createElement("p");
  goal.className = "checklist-goal";
  goal.textContent =
    onboarding.checklist.completed === onboarding.checklist.total
      ? "Ready. You can now talk to your agent in a stable loop."
      : "Talk to your agent in under 10 minutes by completing every item below.";

  const list = document.createElement("ul");
  list.className = "checklist-items";

  for (const item of onboarding.checklist.items) {
    const li = document.createElement("li");
    li.className = `checklist-item ${item.ok ? "good" : "bad"}`;

    const title = document.createElement("span");
    title.className = "checklist-label";
    title.textContent = item.label;

    const message = document.createElement("small");
    message.className = "checklist-message";
    message.textContent = item.message;

    li.append(title, message);
    list.append(li);
  }

  const metrics = document.createElement("div");
  metrics.className = "checklist-metrics";
  metrics.innerHTML = [
    `First setup: ${formatTimestamp(onboarding.firstSetupAt)}`,
    `First voice success: ${formatTimestamp(onboarding.firstVoiceSuccessAt)}`,
    `Time to first success: ${formatDuration(onboarding.timeToFirstSuccessMs)}`,
    `Last voice test: ${formatTimestamp(onboarding.lastVoiceTestAt)}`
  ]
    .map((entry) => `<p>${entry}</p>`)
    .join("");

  firstSuccessChecklist.append(progress, goal, list, metrics);
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

function contextMeta(message: ConversationContextMessage): string {
  const role = message.role.toUpperCase();
  const at = formatTimestamp(message.at);
  const turn = typeof message.turn === "number" ? ` · turn ${message.turn}` : "";
  const status = message.status ? ` · ${displayCode(message.status)}` : "";
  const action = message.action ? ` · ${displayCode(message.action)}` : "";
  const code = message.code ? ` · ${displayCode(message.code)}` : "";
  return `${role} · ${at}${turn}${status}${action}${code}`;
}

async function refreshConversationContext(sessionId: string | null): Promise<void> {
  if (!conversationContext) {
    return;
  }

  conversationContext.innerHTML = "";
  if (!sessionId) {
    appendEmptyState(conversationContext, "Live context appears when a conversation session is available.");
    return;
  }

  try {
    const response = await api<ConversationContextResponse>(
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
      meta.textContent = contextMeta(message);

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

function renderConversationPanel(health: HealthResponse): void {
  if (!conversationState || !conversationBadges || !conversationTurns || !conversationContext || !conversationEnd) {
    return;
  }

  conversationState.innerHTML = "";
  conversationBadges.innerHTML = "";
  conversationTurns.innerHTML = "";
  conversationContext.innerHTML = "";
  activeConversationSessionId = null;

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

  activeConversationSessionId = active.state === "ended" ? null : active.sessionId;
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
    active.state === "ended" ? "bad" : active.state === "awaiting_assistant" || active.state === "agent_responding" ? "warn" : "good";
  conversationBadges.append(
    conversationBadge("State", active.state, stateBadgeState),
    conversationBadge("Turn", `${active.totalTurns}/${active.turnLimit}`, "warn"),
    conversationBadge("TTL", `${Math.ceil(active.expiresInMs / 1000)}s`, ttlState),
    conversationBadge("Stop Requested", active.stopRequested || snapshot.stopRequested ? "yes" : "no", active.stopRequested || snapshot.stopRequested ? "warn" : "good")
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

  conversationEnd.disabled = activeConversationSessionId === null;
  void refreshConversationContext(active.sessionId);
}

function appendProfileLine(container: HTMLElement, text: string, strong = false): void {
  const el = document.createElement(strong ? "strong" : "small");
  el.textContent = text;
  container.append(el, document.createElement("br"));
}

function profileCard(profile: Profile, activeProfileId: string): HTMLElement {
  const card = document.createElement("article");
  card.className = `profile-card ${profile.id === activeProfileId ? "active" : ""}`;

  appendProfileLine(card, profile.name, true);
  appendProfileLine(card, `ID: ${profile.id}`);
  appendProfileLine(card, `Voice: ${profile.voiceName} (${profile.voiceId})`);
  appendProfileLine(card, `Wake: ${profile.wakeWord}`);

  const actions = document.createElement("div");
  actions.className = "profile-actions";

  const wakeInput = document.createElement("input");
  wakeInput.type = "text";
  wakeInput.value = profile.wakeWord;
  wakeInput.setAttribute("aria-label", `Wake word for ${profile.name}`);

  const saveWake = document.createElement("button");
  saveWake.textContent = "Save Wake Word";
  saveWake.className = "secondary";
  saveWake.addEventListener("click", async () => {
    try {
      const wakeWord = wakeInput.value.trim();
      if (!wakeWord) {
        setStatus("Wake word cannot be empty.", true);
        return;
      }
      await api(`/v1/profiles/${profile.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          wakeWord,
          wakeWordVariants: [wakeWord.toLowerCase()]
        })
      });
      setStatus(`Wake word updated for ${profile.name}`);
      await refreshProfiles();
      await refreshHealth();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  const activate = document.createElement("button");
  activate.textContent = "Activate";
  activate.className = "secondary";
  activate.addEventListener("click", async () => {
    try {
      await api(`/v1/profiles/${profile.id}/activate`, { method: "POST" });
      setStatus(`Activated ${profile.name}`);
      await refreshProfiles();
      await refreshHealth();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  const remove = document.createElement("button");
  remove.textContent = "Delete";
  remove.className = "danger";
  remove.addEventListener("click", async () => {
    try {
      if (!confirm(`Delete profile ${profile.name}?`)) {
        return;
      }
      await api(`/v1/profiles/${profile.id}`, { method: "DELETE" });
      setStatus(`Deleted ${profile.name}`);
      await refreshProfiles();
      await refreshHealth();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  actions.append(wakeInput, saveWake, activate, remove);
  card.append(actions);
  return card;
}

async function refreshProfiles(): Promise<void> {
  if (!profileList) {
    return;
  }

  const data = await api<ProfilesResponse>("/v1/profiles");
  profileList.innerHTML = "";

  if (data.profiles.length === 0) {
    appendEmptyState(profileList, "No profiles yet. Save setup above to create your first profile.");
    return;
  }

  for (const profile of data.profiles) {
    profileList.append(profileCard(profile, data.activeProfileId));
  }
}

async function refreshHealth(): Promise<void> {
  if (!healthPre) {
    return;
  }

  const health = await api<HealthResponse>("/v1/health");
  latestHealth = health;
  healthPre.textContent = JSON.stringify(health, null, 2);
  renderRuntimeStatus(health.bridgeRuntime, health.roundTrip, health.metrics);
  renderServiceSummary(health);
  renderFirstSuccessChecklist(health);
  renderConversationPanel(health);
}

function renderEvent(payload: StreamEvent): HTMLElement {
  const item = document.createElement("li");
  item.className = "event-item";

  const top = document.createElement("div");
  top.className = "event-top";

  const type = document.createElement("span");
  type.className = "event-type";
  type.textContent = eventTitle(payload.type);

  const time = document.createElement("span");
  time.className = "event-time";
  time.textContent = formatTimestamp(payload.time);

  top.append(type, time);
  item.append(top);

  const summary = document.createElement("p");
  summary.className = "event-summary";
  summary.textContent = eventSummary(payload);
  item.append(summary);

  if (DEBUG_MODE) {
    const pre = document.createElement("pre");
    pre.className = "event-payload";
    pre.textContent = JSON.stringify(payload.payload, null, 2);
    item.append(pre);
  }

  return item;
}

function bindEvents(): void {
  if (!eventsList) {
    return;
  }

  const source = new EventSource("/v1/events");
  source.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as StreamEvent;
      eventsList.prepend(renderEvent(parsed));
    } catch {
      const fallback = document.createElement("li");
      fallback.className = "event-item";
      fallback.textContent = event.data;
      eventsList.prepend(fallback);
    }

    while (eventsList.children.length > 25) {
      eventsList.removeChild(eventsList.lastChild as Node);
    }
  };
}

function clearSetupValidationState(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLInputElement>("[data-setup-field]").forEach((input) => {
    input.classList.remove("input-invalid");
    input.setAttribute("aria-invalid", "false");
  });

  form.querySelectorAll<HTMLElement>("[data-setup-error]").forEach((fieldError) => {
    fieldError.textContent = "";
  });

  if (setupValidationSummary) {
    setupValidationSummary.innerHTML = "";
    setupValidationSummary.classList.remove("visible");
  }
}

function renderSetupValidationState(form: HTMLFormElement, errors: Partial<Record<SetupFieldName, string>>): void {
  clearSetupValidationState(form);
  const entries = Object.entries(errors) as Array<[SetupFieldName, string]>;

  for (const [field, message] of entries) {
    const input = form.querySelector<HTMLInputElement>(`[data-setup-field="${field}"]`);
    const fieldError = form.querySelector<HTMLElement>(`[data-setup-error="${field}"]`);
    if (input) {
      input.classList.add("input-invalid");
      input.setAttribute("aria-invalid", "true");
    }
    if (fieldError) {
      fieldError.textContent = message;
    }
  }

  if (setupValidationSummary && entries.length > 0) {
    const list = document.createElement("ul");
    for (const [, message] of entries) {
      const item = document.createElement("li");
      item.textContent = message;
      list.append(item);
    }

    const intro = document.createElement("p");
    intro.textContent = "Please fix these fields before continuing:";

    setupValidationSummary.innerHTML = "";
    setupValidationSummary.append(intro, list);
    setupValidationSummary.classList.add("visible");
  }
}

function validateSetupPayload(form: HTMLFormElement): { payload: SetupPayload | null; errors: Partial<Record<SetupFieldName, string>> } {
  const data = new FormData(form);

  const profileName = String(data.get("profileName") ?? "").trim();
  const apiKey = optionalField(data.get("apiKey"));
  const voiceId = String(data.get("voiceId") ?? "").trim();
  const voiceName = String(data.get("voiceName") ?? "").trim();
  const wakeWord = String(data.get("wakeWord") ?? "").trim();
  const telegramToken = optionalField(data.get("telegramToken"));
  const telegramChatId = optionalField(data.get("telegramChatId"));

  const errors: Partial<Record<SetupFieldName, string>> = {};

  if (profileName.length === 0) {
    errors.profileName = "Profile name is required.";
  } else if (profileName.length > FIELD_MAX.profileName) {
    errors.profileName = `Profile name must be ${FIELD_MAX.profileName} characters or fewer.`;
  }

  if (voiceId.length === 0) {
    errors.voiceId = "Voice ID is required.";
  } else if (voiceId.length > FIELD_MAX.voiceId) {
    errors.voiceId = `Voice ID must be ${FIELD_MAX.voiceId} characters or fewer.`;
  }

  if (voiceName.length === 0) {
    errors.voiceName = "Voice name is required.";
  } else if (voiceName.length > FIELD_MAX.voiceName) {
    errors.voiceName = `Voice name must be ${FIELD_MAX.voiceName} characters or fewer.`;
  }

  if (wakeWord.length === 0) {
    errors.wakeWord = "Wake word is required.";
  } else if (wakeWord.length > FIELD_MAX.wakeWord) {
    errors.wakeWord = `Wake word must be ${FIELD_MAX.wakeWord} characters or fewer.`;
  }

  if (!apiKeyReadyForActiveProfile() && !apiKey) {
    errors.apiKey = "API key is required until health confirms a valid active key (0600).";
  }

  if (apiKey && apiKey.length > FIELD_MAX.apiKey) {
    errors.apiKey = "API key appears too long. Please paste a valid key.";
  }

  const hasToken = Boolean(telegramToken);
  const hasChatId = Boolean(telegramChatId);
  if (hasToken !== hasChatId) {
    if (!hasToken) {
      errors.telegramToken = "Telegram bot token is required when chat ID is provided.";
    }
    if (!hasChatId) {
      errors.telegramChatId = "Telegram chat ID is required when bot token is provided.";
    }
  }

  if (telegramChatId && telegramChatId.length > FIELD_MAX.telegramChatId) {
    errors.telegramChatId = `Telegram chat ID must be ${FIELD_MAX.telegramChatId} characters or fewer.`;
  }

  if (Object.keys(errors).length > 0) {
    return { payload: null, errors };
  }

  return {
    payload: {
      profileName,
      apiKey,
      voiceId,
      voiceName,
      wakeWord,
      telegramToken,
      telegramChatId
    },
    errors
  };
}

function bindQuickActions(): void {
  const refresh = document.querySelector<HTMLButtonElement>("#refresh-health");
  refresh?.addEventListener("click", async () => {
    try {
      await refreshHealth();
      setStatus("Status refreshed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  const listenerRestart = document.querySelector<HTMLButtonElement>("#restart-listener");
  listenerRestart?.addEventListener("click", async () => {
    try {
      await api<{ result: ServiceStatusResult }>("/v1/listener/restart", { method: "POST" });
      setStatus("Listener restart requested.");
      await refreshHealth();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  const bridgeRestart = document.querySelector<HTMLButtonElement>("#restart-bridge");
  bridgeRestart?.addEventListener("click", async () => {
    try {
      await api<{ result: ServiceStatusResult }>("/v1/bridge/restart", { method: "POST" });
      setStatus("Bridge restart requested.");
      await refreshHealth();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  const testButton = document.querySelector<HTMLButtonElement>("#test-voice");
  testButton?.addEventListener("click", async () => {
    try {
      await api("/v1/speak/test", {
        method: "POST",
        body: JSON.stringify({ text: "Faye is online." })
      });
      setStatus("Voice test played.");
      await refreshHealth();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
      await refreshHealth().catch(() => undefined);
    }
  });

  conversationEnd?.addEventListener("click", async () => {
    if (!activeConversationSessionId) {
      setStatus("No active conversation session to end.");
      return;
    }

    try {
      await api(`/v1/conversation/${encodeURIComponent(activeConversationSessionId)}/end`, {
        method: "POST",
        body: JSON.stringify({
          reason: "external_stop"
        })
      });
      setStatus("Force stop requested for active conversation session.");
      await refreshHealth();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });
}

function normalizedConfirmation(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function summarizeRecoveryResult(result: SystemRecoveryResult): string {
  const failures = result.errors.length;
  const base = result.action === "panic-stop" ? "Panic Stop completed." : "Factory Reset completed.";
  if (failures > 0) {
    return `${base} ${failures} warning${failures === 1 ? "" : "s"} reported.`;
  }
  return base;
}

function bindRecoveryActions(): void {
  const panicButton = panicStopButton;
  const resetButton = factoryResetButton;

  if (panicButton) {
    panicButton.addEventListener("click", async () => {
      const typed = normalizedConfirmation(panicConfirmationInput?.value ?? "");
      if (typed !== PANIC_STOP_CONFIRMATION) {
        setRecoveryStatus(`Type ${PANIC_STOP_CONFIRMATION} exactly to enable Panic Stop.`, true);
        return;
      }

      panicButton.disabled = true;
      try {
        const response = await api<SystemRecoveryResponse>("/v1/system/panic-stop", {
          method: "POST",
          body: JSON.stringify({
            confirmation: typed,
            reason: "dashboard_panic_stop"
          })
        });
        setRecoveryStatus(summarizeRecoveryResult(response.result), response.ok !== true);
        if (panicConfirmationInput) {
          panicConfirmationInput.value = "";
        }
        await refreshHealth();
      } catch (error) {
        setRecoveryStatus(error instanceof Error ? error.message : String(error), true);
      } finally {
        panicButton.disabled = false;
      }
    });
  }

  if (!resetButton) {
    return;
  }

  resetButton.addEventListener("click", async () => {
    const resetTyped = normalizedConfirmation(factoryResetConfirmationInput?.value ?? "");
    if (resetTyped !== FACTORY_RESET_CONFIRMATION) {
      setRecoveryStatus(`Type ${FACTORY_RESET_CONFIRMATION} exactly to enable Factory Reset.`, true);
      return;
    }

    resetButton.disabled = true;
    try {
      const response = await api<SystemRecoveryResponse>("/v1/system/factory-reset", {
        method: "POST",
        body: JSON.stringify({
          confirmation: resetTyped,
          reason: "dashboard_factory_reset"
        })
      });
      const message = `${summarizeRecoveryResult(response.result)} Run install again and reopen the dashboard.`;
      setRecoveryStatus(message, response.ok !== true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRecoveryStatus(
        `Factory reset likely interrupted the dashboard service. Start fresh with install, then run "faye open". (${message})`,
        false
      );
    } finally {
      resetButton.disabled = false;
      if (factoryResetConfirmationInput) {
        factoryResetConfirmationInput.value = "";
      }
    }
  });
}

function bindSetupForm(): void {
  const form = document.querySelector<HTMLFormElement>("#setup-form");
  if (!form) {
    return;
  }

  form.querySelectorAll<HTMLInputElement>("[data-setup-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const field = input.getAttribute("data-setup-field") as SetupFieldName | null;
      if (!field) {
        return;
      }

      const errors: Partial<Record<SetupFieldName, string>> = {};
      if (field === "telegramToken" || field === "telegramChatId") {
        renderSetupValidationState(form, errors);
        return;
      }

      const fieldError = form.querySelector<HTMLElement>(`[data-setup-error="${field}"]`);
      if (fieldError) {
        fieldError.textContent = "";
      }
      input.classList.remove("input-invalid");
      input.setAttribute("aria-invalid", "false");
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const validated = validateSetupPayload(form);
    if (!validated.payload) {
      renderSetupValidationState(form, validated.errors);
      setStatus("Setup blocked until validation errors are fixed.", true);
      return;
    }

    clearSetupValidationState(form);

    try {
      await api("/v1/setup", {
        method: "POST",
        body: JSON.stringify(validated.payload)
      });
      setStatus("Setup saved.");
      await refreshProfiles();
      await refreshHealth();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });
}

function bindCreateProfileForm(): void {
  const form = document.querySelector<HTMLFormElement>("#create-profile-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);

    try {
      await api("/v1/profiles", {
        method: "POST",
        body: JSON.stringify({
          name: String(data.get("name")),
          voiceId: String(data.get("voiceId")),
          voiceName: String(data.get("voiceName")),
          wakeWord: String(data.get("wakeWord")),
          wakeWordVariants: [String(data.get("wakeWord")).toLowerCase()],
          model: "eleven_multilingual_v2",
          stability: 0.4,
          similarityBoost: 0.8,
          style: 0.7,
          elevenLabsApiKeyPath: "~/.openclaw/secrets/elevenlabs-api-key.txt",
          silenceThreshold: "0.5%"
        })
      });
      setStatus("Profile created.");
      form.reset();
      await refreshProfiles();
      await refreshHealth();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });
}

async function bootstrap(): Promise<void> {
  bindQuickActions();
  bindRecoveryActions();
  bindSetupForm();
  bindCreateProfileForm();
  bindEvents();
  await refreshProfiles();
  await refreshHealth();
  setInterval(() => {
    void refreshHealth();
  }, 15000);
  setInterval(() => {
    if (activeConversationSessionId) {
      void refreshConversationContext(activeConversationSessionId);
    }
  }, 4000);
}

void bootstrap();
