import type { AppEvent, EventHub } from "./events";
import type { Logger } from "./logger";
import { expandHomePath, pathExists, readSecret } from "./utils";
import {
  DEFAULT_RETRY_LIMIT,
  DEFAULT_WATCHDOG_MS,
  STALE_SESSION_MS,
  formatIso,
  sendTelegram,
  toSessionId,
  toSpokenStatus,
  toText
} from "./roundTripCoordinatorHelpers";

export type RoundTripSessionState = "wake_detected" | "awaiting_speak" | "speak_received";
type SpokenStatus = "ok" | "error" | "duplicate";

interface SessionRecord {
  id: string;
  state: RoundTripSessionState;
  createdAtMs: number;
  updatedAtMs: number;
  retryCount: number;
  text?: string;
  timer?: ReturnType<typeof setTimeout>;
}

interface SessionSummary {
  sessionId: string;
  at: string;
  retryCount: number;
}

interface CompletedSummary extends SessionSummary {
  status: SpokenStatus;
}

interface TimedOutSummary extends SessionSummary {
  reason: "watchdog" | "retry_send_failed" | "retry_unavailable";
}

export interface RoundTripSnapshot {
  watchdogMs: number;
  autoRetryLimit: number;
  activeSessions: number;
  pendingSessions: Array<{
    sessionId: string;
    state: RoundTripSessionState;
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
  lastCompleted: CompletedSummary | null;
  lastTimeout: TimedOutSummary | null;
}

export interface RoundTripSessionStatus {
  sessionId: string;
  pending: boolean;
  state: RoundTripSessionState | null;
  retryCount: number;
  updatedAt: string | null;
}

interface ActiveProfileProvider {
  getActiveProfile(): {
    telegramBotTokenPath?: string;
    telegramChatId?: string;
  };
}

interface TelegramCredentials {
  botToken: string;
  chatId: number;
}

interface RoundTripCoordinatorDeps {
  events: EventHub;
  store: ActiveProfileProvider;
  logger: Logger;
  watchdogMs?: number;
  autoRetryLimit?: number;
  nowMsFn?: () => number;
  sendTelegramFn?: (botToken: string, chatId: number, text: string) => Promise<void>;
  resolveTelegramFn?: () => Promise<TelegramCredentials | null>;
}

export class RoundTripCoordinator {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly watchdogMs: number;
  private readonly autoRetryLimit: number;
  private readonly nowMsFn: () => number;
  private readonly sendTelegramFn: (botToken: string, chatId: number, text: string) => Promise<void>;
  private readonly resolveTelegramFn?: () => Promise<TelegramCredentials | null>;
  private readonly unsubscribe: () => void;

  private readonly totals = {
    started: 0,
    retriesSent: 0,
    completed: 0,
    timeouts: 0
  };

  private lastCompleted: CompletedSummary | null = null;
  private lastTimeout: TimedOutSummary | null = null;

  constructor(private readonly deps: RoundTripCoordinatorDeps) {
    this.watchdogMs = Math.max(10, deps.watchdogMs ?? DEFAULT_WATCHDOG_MS);
    this.autoRetryLimit = Math.max(0, deps.autoRetryLimit ?? DEFAULT_RETRY_LIMIT);
    this.nowMsFn = deps.nowMsFn ?? (() => Date.now());
    this.sendTelegramFn = deps.sendTelegramFn ?? sendTelegram;
    this.resolveTelegramFn = deps.resolveTelegramFn;

    this.unsubscribe = deps.events.subscribe((event) => {
      void this.handleEvent(event);
    });
  }

  getSnapshot(): RoundTripSnapshot {
    const now = this.nowMsFn();
    const pendingSessions = [...this.sessions.values()]
      .sort((a, b) => a.createdAtMs - b.createdAtMs)
      .slice(-8)
      .map((session) => ({
        sessionId: session.id,
        state: session.state,
        retryCount: session.retryCount,
        ageMs: Math.max(0, now - session.createdAtMs),
        updatedAt: formatIso(session.updatedAtMs)
      }));

    return {
      watchdogMs: this.watchdogMs,
      autoRetryLimit: this.autoRetryLimit,
      activeSessions: this.sessions.size,
      pendingSessions,
      totals: { ...this.totals },
      lastCompleted: this.lastCompleted ? { ...this.lastCompleted } : null,
      lastTimeout: this.lastTimeout ? { ...this.lastTimeout } : null
    };
  }

  getSessionStatus(sessionId: string): RoundTripSessionStatus {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        sessionId,
        pending: false,
        state: null,
        retryCount: 0,
        updatedAt: null
      };
    }

    return {
      sessionId,
      pending: true,
      state: session.state,
      retryCount: session.retryCount,
      updatedAt: formatIso(session.updatedAtMs)
    };
  }

  stop(): void {
    this.unsubscribe();
    for (const session of this.sessions.values()) {
      this.clearTimer(session);
    }
    this.sessions.clear();
  }

  private async handleEvent(event: AppEvent): Promise<void> {
    const payload = event.payload ?? {};
    const now = this.nowMsFn();
    this.pruneStale(now);

    if (event.type === "wake_detected") {
      const sessionId = toSessionId(payload);
      if (!sessionId) {
        return;
      }
      this.handleWakeDetected(sessionId, now);
      return;
    }

    if (event.type === "message_transcribed") {
      const sessionId = toSessionId(payload);
      const text = toText(payload);
      if (!sessionId || !text) {
        return;
      }
      this.handleMessageTranscribed(sessionId, text, now);
      return;
    }

    if (event.type === "bridge_speak_received") {
      const sessionId = toSessionId(payload);
      if (!sessionId) {
        return;
      }
      this.handleSpeakReceived(sessionId, now);
      return;
    }

    if (event.type === "bridge_spoken") {
      const sessionId = toSessionId(payload);
      const status = toSpokenStatus(payload);
      if (!sessionId || !status) {
        return;
      }
      this.handleSpoken(sessionId, status, now);
    }
  }

  private handleWakeDetected(sessionId: string, now: number): void {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.clearTimer(existing);
      this.loggerWarn("ROUNDTRIP_WAKE_RESET", "Resetting existing round-trip session on wake event", {
        sessionId,
        previousState: existing.state
      });
    } else {
      this.totals.started += 1;
    }

    this.sessions.set(sessionId, {
      id: sessionId,
      state: "wake_detected",
      createdAtMs: now,
      updatedAtMs: now,
      retryCount: 0
    });
  }

  private handleMessageTranscribed(sessionId: string, text: string, now: number): void {
    const session = this.ensureSession(sessionId, now);
    if (session.state === "speak_received") {
      this.loggerWarn("ROUNDTRIP_OUT_OF_ORDER", "Message received after speak command", {
        sessionId
      });
      return;
    }

    if (session.state !== "wake_detected" && session.state !== "awaiting_speak") {
      this.loggerWarn("ROUNDTRIP_STATE_INVALID", "Cannot transition session to awaiting_speak from current state", {
        sessionId,
        state: session.state
      });
      return;
    }

    session.state = "awaiting_speak";
    session.text = text;
    session.updatedAtMs = now;
    this.armWatchdog(session);
  }

  private handleSpeakReceived(sessionId: string, now: number): void {
    const session = this.ensureSession(sessionId, now);
    if (session.state === "wake_detected") {
      this.loggerWarn("ROUNDTRIP_OUT_OF_ORDER", "Speak command arrived before transcribed message event", {
        sessionId
      });
    } else if (session.state !== "awaiting_speak") {
      this.loggerWarn("ROUNDTRIP_STATE_INVALID", "Unexpected speak command for session state", {
        sessionId,
        state: session.state
      });
    }

    session.state = "speak_received";
    session.updatedAtMs = now;
    this.clearTimer(session);
  }

  private handleSpoken(sessionId: string, status: SpokenStatus, now: number): void {
    const session = this.ensureSession(sessionId, now);
    if (session.state !== "speak_received") {
      this.loggerWarn("ROUNDTRIP_OUT_OF_ORDER", "Spoken ack arrived before explicit speak state", {
        sessionId,
        state: session.state,
        status
      });
    }

    this.clearTimer(session);
    this.sessions.delete(sessionId);
    this.totals.completed += 1;
    this.lastCompleted = {
      sessionId,
      at: formatIso(now),
      retryCount: session.retryCount,
      status
    };
  }

  private ensureSession(sessionId: string, now: number): SessionRecord {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const created: SessionRecord = {
      id: sessionId,
      state: "wake_detected",
      createdAtMs: now,
      updatedAtMs: now,
      retryCount: 0
    };
    this.sessions.set(sessionId, created);
    this.totals.started += 1;
    this.loggerWarn("ROUNDTRIP_SESSION_IMPLIED", "Creating missing session from out-of-order event", {
      sessionId
    });
    return created;
  }

  private armWatchdog(session: SessionRecord): void {
    this.clearTimer(session);
    session.timer = setTimeout(() => {
      void this.handleWatchdogTimeout(session.id);
    }, this.watchdogMs);
  }

  private clearTimer(session: SessionRecord): void {
    if (!session.timer) {
      return;
    }
    clearTimeout(session.timer);
    session.timer = undefined;
  }

  private async handleWatchdogTimeout(sessionId: string): Promise<void> {
    const now = this.nowMsFn();
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== "awaiting_speak") {
      return;
    }

    if (session.retryCount < this.autoRetryLimit && session.text) {
      const retryResult = await this.sendRetry(session);
      if (retryResult === "sent") {
        session.retryCount += 1;
        session.updatedAtMs = now;
        this.totals.retriesSent += 1;
        this.deps.events.publish("session_retry_sent", {
          session_id: session.id,
          retry_count: session.retryCount,
          text_length: session.text.length
        });
        this.armWatchdog(session);
        return;
      }

      this.markTimedOut(session, now, retryResult === "no_credentials" ? "retry_unavailable" : "retry_send_failed");
      return;
    }

    this.markTimedOut(session, now, "watchdog");
  }

  private markTimedOut(session: SessionRecord, now: number, reason: TimedOutSummary["reason"]): void {
    this.clearTimer(session);
    this.sessions.delete(session.id);
    this.totals.timeouts += 1;
    this.lastTimeout = {
      sessionId: session.id,
      at: formatIso(now),
      retryCount: session.retryCount,
      reason
    };

    this.deps.events.publish("session_timeout", {
      session_id: session.id,
      retry_count: session.retryCount,
      reason
    });

    this.loggerWarn("ROUNDTRIP_TIMEOUT", "Round-trip watchdog timeout", {
      sessionId: session.id,
      retryCount: session.retryCount,
      reason
    });
  }

  private async sendRetry(session: SessionRecord): Promise<"sent" | "no_credentials" | "send_failed"> {
    const credentials = await this.resolveTelegramCredentials();
    if (!credentials) {
      this.loggerWarn("ROUNDTRIP_RETRY_SKIPPED", "No Telegram credentials available for round-trip retry", {
        sessionId: session.id
      });
      return "no_credentials";
    }

    try {
      await this.sendTelegramFn(
        credentials.botToken,
        credentials.chatId,
        `#faye_voice session=${session.id} retry=1 text=${session.text ?? ""}`
      );
      return "sent";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.loggerWarn("ROUNDTRIP_RETRY_FAILED", "Round-trip retry send failed", {
        sessionId: session.id,
        message
      });
      return "send_failed";
    }
  }

  private async resolveTelegramCredentials(): Promise<TelegramCredentials | null> {
    if (this.resolveTelegramFn) {
      return this.resolveTelegramFn();
    }

    const active = this.deps.store.getActiveProfile();
    if (!active.telegramBotTokenPath || !active.telegramChatId) {
      return null;
    }

    const chatId = Number(active.telegramChatId);
    if (!Number.isFinite(chatId)) {
      return null;
    }

    const tokenPath = expandHomePath(active.telegramBotTokenPath);
    if (!(await pathExists(tokenPath))) {
      return null;
    }

    const botToken = await readSecret(tokenPath);
    if (!botToken) {
      return null;
    }

    return {
      botToken,
      chatId
    };
  }

  private pruneStale(now: number): void {
    for (const session of this.sessions.values()) {
      if (now - session.updatedAtMs <= STALE_SESSION_MS) {
        continue;
      }
      this.clearTimer(session);
      this.sessions.delete(session.id);
      this.loggerWarn("ROUNDTRIP_STALE_PRUNED", "Pruned stale round-trip session", {
        sessionId: session.id,
        state: session.state
      });
    }
  }

  private loggerWarn(code: string, message: string, context?: unknown): void {
    this.deps.logger.warn(code, message, context);
  }
}
