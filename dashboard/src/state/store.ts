export interface Profile {
  id: string;
  name: string;
  voiceId: string;
  voiceName: string;
  wakeWord: string;
}

export interface ProfilesResponse {
  activeProfileId: string;
  profiles: Profile[];
}

export interface BridgeRuntimeStatus {
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

export interface RoundTripSnapshot {
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

export interface MetricsSnapshot {
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

export interface ConversationTurnSnapshot {
  turn: number;
  userText: string | null;
  userAt: string | null;
  assistantText: string | null;
  assistantAt: string | null;
  assistantStatus: "ok" | "error" | "duplicate" | "pending" | null;
}

export interface ConversationSessionSnapshot {
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

export interface ConversationSnapshot {
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

export interface ConversationContextMessage {
  role: "user" | "assistant" | "system";
  text: string;
  at: string;
  turn?: number;
  status?: string;
  action?: string;
  code?: string;
}

export interface ConversationContext {
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

export interface ConversationContextResponse {
  context: ConversationContext;
}

export interface ServiceStatusResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface OnboardingChecklistItem {
  id: string;
  label: string;
  ok: boolean;
  message: string;
}

export interface OnboardingSummary {
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

export interface SystemRecoveryServiceResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface SystemRecoveryResult {
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

export interface SystemRecoveryResponse {
  ok: boolean;
  result: SystemRecoveryResult;
}

export interface HealthResponse {
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

export interface StreamEvent {
  id: string;
  type: string;
  time: string;
  payload: Record<string, unknown>;
}

export type SetupFieldName =
  | "profileName"
  | "apiKey"
  | "voiceId"
  | "voiceName"
  | "wakeWord"
  | "telegramToken"
  | "telegramChatId";

export interface SetupPayload {
  profileName: string;
  apiKey?: string;
  voiceId: string;
  voiceName: string;
  wakeWord: string;
  telegramToken?: string;
  telegramChatId?: string;
}

export const FIELD_MAX: Record<SetupFieldName, number> = {
  profileName: 80,
  apiKey: 300,
  voiceId: 128,
  voiceName: 128,
  wakeWord: 120,
  telegramToken: 300,
  telegramChatId: 64
};

export const PANIC_STOP_CONFIRMATION = "PANIC STOP";
export const FACTORY_RESET_CONFIRMATION = "FACTORY RESET";

export const DEBUG_MODE = new URLSearchParams(window.location.search).get("debug") === "1";

export const EVENT_LABELS: Record<string, string> = {
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

export interface DashboardElements {
  setupStatus: HTMLParagraphElement | null;
  setupValidationSummary: HTMLDivElement | null;
  profileList: HTMLDivElement | null;
  healthPre: HTMLPreElement | null;
  eventsList: HTMLUListElement | null;
  runtimeStatus: HTMLDivElement | null;
  serviceSummary: HTMLDivElement | null;
  firstSuccessChecklist: HTMLDivElement | null;
  conversationState: HTMLDivElement | null;
  conversationBadges: HTMLDivElement | null;
  conversationTurns: HTMLUListElement | null;
  conversationContext: HTMLUListElement | null;
  conversationEnd: HTMLButtonElement | null;
  panicConfirmationInput: HTMLInputElement | null;
  factoryResetConfirmationInput: HTMLInputElement | null;
  panicStopButton: HTMLButtonElement | null;
  factoryResetButton: HTMLButtonElement | null;
  recoveryStatus: HTMLParagraphElement | null;
}

export interface DashboardState {
  elements: DashboardElements;
  latestHealth: HealthResponse | null;
  activeConversationSessionId: string | null;
  refreshHealthInFlight: Promise<void> | null;
  eventSource: EventSource | null;
  eventReconnectTimer: number | null;
  eventReconnectAttempts: number;
  refreshHealthIntervalId: number | null;
  refreshContextIntervalId: number | null;
}

export function queryDashboardElements(): DashboardElements {
  return {
    setupStatus: document.querySelector<HTMLParagraphElement>("#setup-status"),
    setupValidationSummary: document.querySelector<HTMLDivElement>("#setup-validation-summary"),
    profileList: document.querySelector<HTMLDivElement>("#profile-list"),
    healthPre: document.querySelector<HTMLPreElement>("#health"),
    eventsList: document.querySelector<HTMLUListElement>("#events"),
    runtimeStatus: document.querySelector<HTMLDivElement>("#runtime-status"),
    serviceSummary: document.querySelector<HTMLDivElement>("#service-summary"),
    firstSuccessChecklist: document.querySelector<HTMLDivElement>("#first-success-checklist"),
    conversationState: document.querySelector<HTMLDivElement>("#conversation-state"),
    conversationBadges: document.querySelector<HTMLDivElement>("#conversation-badges"),
    conversationTurns: document.querySelector<HTMLUListElement>("#conversation-turns"),
    conversationContext: document.querySelector<HTMLUListElement>("#conversation-context"),
    conversationEnd: document.querySelector<HTMLButtonElement>("#conversation-end"),
    panicConfirmationInput: document.querySelector<HTMLInputElement>("#panic-confirmation"),
    factoryResetConfirmationInput: document.querySelector<HTMLInputElement>("#factory-reset-confirmation"),
    panicStopButton: document.querySelector<HTMLButtonElement>("#panic-stop-button"),
    factoryResetButton: document.querySelector<HTMLButtonElement>("#factory-reset-button"),
    recoveryStatus: document.querySelector<HTMLParagraphElement>("#recovery-status")
  };
}

export function createDashboardState(): DashboardState {
  return {
    elements: queryDashboardElements(),
    latestHealth: null,
    activeConversationSessionId: null,
    refreshHealthInFlight: null,
    eventSource: null,
    eventReconnectTimer: null,
    eventReconnectAttempts: 0,
    refreshHealthIntervalId: null,
    refreshContextIntervalId: null
  };
}
