import type { AppEvent, EventHub } from "./events";
import type { Logger } from "./logger";
import type {
  BridgeActionName,
  ConversationContext,
  ConversationContextMessage,
  ConversationMessageStatus,
  ConversationTurnPolicy
} from "./types";
import {
  DEFAULT_MAX_CONTEXT_MESSAGES,
  DEFAULT_MAX_SESSIONS,
  DEFAULT_MAX_TURNS_PER_SESSION,
  DEFAULT_TTL_MS,
  MAX_CONTEXT_LIMIT,
  clampContextLimit,
  clampTurnPolicy,
  formatIso,
  normalizeReason,
  toActionCode,
  toActionExecutionStatus,
  toBoolean,
  toBridgeAction,
  toListenerStatus,
  toReason,
  toSessionId,
  toSpokenStatus,
  toText,
  toTurn,
  toTurnLimit,
  toWaitResult
} from "./conversationSessionManagerHelpers";

type SpokenStatus = "ok" | "error" | "duplicate";
type SessionState = "awaiting_user" | "awaiting_assistant" | "agent_responding" | "ended";

interface ConversationTurnRecord {
  turn: number;
  userText: string | null;
  userAtMs: number | null;
  assistantText: string | null;
  assistantAtMs: number | null;
  assistantStatus: SpokenStatus | "pending" | null;
}

interface ContextMessageRecord {
  role: "user" | "assistant" | "system";
  text: string;
  atMs: number;
  turn?: number;
  status?: ConversationMessageStatus;
  action?: BridgeActionName;
  code?: string;
}

interface SessionRecord {
  id: string;
  state: SessionState;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
  totalTurns: number;
  turnLimit: number;
  extensionsUsed: number;
  turns: ConversationTurnRecord[];
  contextMessages: ContextMessageRecord[];
  lastTurnAtMs: number | null;
  stopRequested: boolean;
  endReason?: string;
}

interface SessionEndedSummary {
  sessionId: string;
  at: string;
  reason: string;
}

export interface ConversationTurnSnapshot {
  turn: number;
  userText: string | null;
  userAt: string | null;
  assistantText: string | null;
  assistantAt: string | null;
  assistantStatus: SpokenStatus | "pending" | null;
}

export interface ConversationSessionSnapshot {
  sessionId: string;
  state: SessionState;
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
    turnPolicy: ConversationTurnPolicy;
  };
  activeSessions: number;
  retainedSessions: number;
  totals: {
    sessionsOpened: number;
    sessionsEnded: number;
    sessionsExpired: number;
    userTurns: number;
    assistantResponses: number;
  };
  endReasons: Record<string, number>;
  lastEnded: SessionEndedSummary | null;
  sessions: ConversationSessionSnapshot[];
}

interface ConversationContextOptions {
  limit?: number;
  includePending?: boolean;
}

interface ConversationSessionManagerDeps {
  events: EventHub;
  logger: Logger;
  ttlMs?: number;
  maxTurnsPerSession?: number;
  maxSessions?: number;
  turnPolicy?: Partial<ConversationTurnPolicy>;
  nowMsFn?: () => number;
}

export class ConversationSessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly ttlMs: number;
  private readonly maxTurnsPerSession: number;
  private readonly maxSessions: number;
  private readonly maxContextMessagesPerSession: number;
  private readonly turnPolicy: ConversationTurnPolicy;
  private readonly nowMsFn: () => number;
  private readonly unsubscribe: () => void;

  private readonly totals = {
    sessionsOpened: 0,
    sessionsEnded: 0,
    sessionsExpired: 0,
    userTurns: 0,
    assistantResponses: 0
  };

  private readonly endReasonCounts = new Map<string, number>();
  private lastEnded: SessionEndedSummary | null = null;

  constructor(private readonly deps: ConversationSessionManagerDeps) {
    this.turnPolicy = clampTurnPolicy(deps.turnPolicy);
    this.ttlMs = Math.max(5_000, deps.ttlMs ?? DEFAULT_TTL_MS);
    this.maxTurnsPerSession = Math.max(1, deps.maxTurnsPerSession ?? DEFAULT_MAX_TURNS_PER_SESSION);
    this.maxSessions = Math.max(4, deps.maxSessions ?? DEFAULT_MAX_SESSIONS);
    this.maxContextMessagesPerSession = Math.max(
      MAX_CONTEXT_LIMIT,
      Math.max(DEFAULT_MAX_CONTEXT_MESSAGES, this.maxTurnsPerSession * 8)
    );
    this.nowMsFn = deps.nowMsFn ?? (() => Date.now());
    this.unsubscribe = deps.events.subscribe((event) => {
      this.handleEvent(event);
    });
  }

  stop(): void {
    this.unsubscribe();
    this.sessions.clear();
  }

  getSnapshot(): ConversationSnapshot {
    const now = this.nowMsFn();
    this.pruneExpired(now);

    const ordered = this.orderedSessions();

    return {
      policy: {
        ttlMs: this.ttlMs,
        maxTurnsRetainedPerSession: this.maxTurnsPerSession,
        maxSessions: this.maxSessions,
        turnPolicy: { ...this.turnPolicy }
      },
      activeSessions: ordered.filter((session) => session.state !== "ended").length,
      retainedSessions: ordered.length,
      totals: { ...this.totals },
      endReasons: Object.fromEntries(this.endReasonCounts),
      lastEnded: this.lastEnded ? { ...this.lastEnded } : null,
      sessions: ordered.map((session) => this.toSessionSnapshot(session, now))
    };
  }

  getSessionSnapshot(sessionId: string): ConversationSessionSnapshot | null {
    const now = this.nowMsFn();
    this.pruneExpired(now);
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    return this.toSessionSnapshot(session, now);
  }

  getActiveSessionSnapshot(): ConversationSessionSnapshot | null {
    const now = this.nowMsFn();
    this.pruneExpired(now);
    const active = this.orderedSessions().find((session) => session.state !== "ended");
    if (!active) {
      return null;
    }
    return this.toSessionSnapshot(active, now);
  }

  getContext(sessionId: string, options?: ConversationContextOptions): ConversationContext | null {
    const now = this.nowMsFn();
    this.pruneExpired(now);
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const includePending = options?.includePending ?? true;
    const limit = clampContextLimit(options?.limit);
    let messages = session.contextMessages;
    if (!includePending) {
      messages = messages.filter((item) => item.status !== "pending");
    }

    const selected = messages.slice(-limit).map((item) => this.toContextMessage(item));

    return {
      sessionId: session.id,
      state: session.state,
      expiresAt: formatIso(session.expiresAtMs),
      expiresInMs: Math.max(0, session.expiresAtMs - now),
      turnPolicy: { ...this.turnPolicy },
      turnProgress: {
        current: session.totalTurns,
        limit: session.turnLimit,
        remaining: Math.max(0, session.turnLimit - session.totalTurns)
      },
      endReason: session.endReason,
      lastTurnAt: typeof session.lastTurnAtMs === "number" ? formatIso(session.lastTurnAtMs) : null,
      stopRequested: session.stopRequested,
      messages: selected
    };
  }

  endSession(sessionId: string, reason: string): ConversationSessionSnapshot | null {
    const now = this.nowMsFn();
    this.pruneExpired(now);
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const resolvedReason = normalizeReason(reason) ?? "manual_terminated";
    if (resolvedReason === "external_stop") {
      session.stopRequested = true;
    }
    this.markSessionEnded(session, now, resolvedReason);
    return this.toSessionSnapshot(session, now);
  }

  private handleEvent(event: AppEvent): void {
    const now = this.nowMsFn();
    this.pruneExpired(now);
    const payload = event.payload ?? {};
    const sessionId = toSessionId(payload);

    if (event.type === "wake_detected" && sessionId) {
      const session = this.openSession(sessionId, now);
      this.pushContextMessage(session, {
        role: "system",
        text: "Wake detected",
        atMs: now
      });
      return;
    }

    if (event.type === "message_transcribed" && sessionId) {
      this.addUserTurn(sessionId, payload, now);
      return;
    }

    if (event.type === "bridge_speak_received" && sessionId) {
      this.attachAssistantResponse(sessionId, payload, now);
      return;
    }

    if (event.type === "bridge_spoken" && sessionId) {
      this.markAssistantStatus(sessionId, payload, now);
      return;
    }

    if (event.type === "session_timeout" && sessionId) {
      const session = this.sessions.get(sessionId);
      if (session) {
        this.markSessionEnded(session, now, "agent_timeout");
      }
      return;
    }

    if (event.type === "bridge_action_requested" && sessionId) {
      this.recordBridgeActionRequested(sessionId, payload, now);
      return;
    }

    if (event.type === "bridge_action_blocked" && sessionId) {
      this.recordBridgeActionBlocked(sessionId, payload, now);
      return;
    }

    if (event.type === "bridge_action_executed" && sessionId) {
      this.recordBridgeActionExecuted(sessionId, payload, now);
      return;
    }

    if (event.type === "conversation_turn_started" && sessionId) {
      this.recordTurnLifecycle(sessionId, payload, now, "started");
      return;
    }

    if (event.type === "conversation_turn_completed" && sessionId) {
      this.recordTurnLifecycle(sessionId, payload, now, "completed");
      return;
    }

    if (event.type === "conversation_ended" && sessionId) {
      const session = this.sessions.get(sessionId);
      if (session) {
        const reason = toReason(payload) ?? "manual_terminated";
        if (reason === "external_stop") {
          session.stopRequested = true;
        }
        this.markSessionEnded(session, now, reason);
      }
      return;
    }

    if (event.type === "listener_status" && sessionId) {
      const status = toListenerStatus(payload);
      if (!status) {
        return;
      }

      if (status === "conversation_loop_started" || status === "conversation_started") {
        const session = this.openSession(sessionId, now);
        this.applyListenerTurnLimit(session, payload);
        this.pushContextMessage(session, {
          role: "system",
          text: "Conversation loop started",
          atMs: now,
          code: status
        });
        return;
      }

      if (status === "conversation_loop_extended") {
        const session = this.ensureSession(sessionId, now);
        this.applyListenerTurnLimit(session, payload);
        this.pushContextMessage(session, {
          role: "system",
          text: `Conversation turn limit extended to ${session.turnLimit}`,
          atMs: now,
          code: status
        });
        return;
      }

      if (status === "conversation_loop_ended" || status === "conversation_ended") {
        const session = this.sessions.get(sessionId);
        if (session) {
          const reason = toReason(payload) ?? "listener_ended";
          if (reason === "external_stop") {
            session.stopRequested = true;
          }
          this.markSessionEnded(session, now, reason);
        }
      }
    }
  }

  private orderedSessions(): SessionRecord[] {
    return [...this.sessions.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }

  private openSession(sessionId: string, now: number): SessionRecord {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (existing.state === "ended") {
        existing.totalTurns = 0;
        existing.turns = [];
        existing.contextMessages = [];
        existing.lastTurnAtMs = null;
      }
      existing.state = "awaiting_user";
      existing.endReason = undefined;
      existing.updatedAtMs = now;
      existing.expiresAtMs = now + this.ttlMs;
      existing.turnLimit = this.turnPolicy.baseTurns;
      existing.extensionsUsed = 0;
      existing.stopRequested = false;
      return existing;
    }

    const created: SessionRecord = {
      id: sessionId,
      state: "awaiting_user",
      createdAtMs: now,
      updatedAtMs: now,
      expiresAtMs: now + this.ttlMs,
      totalTurns: 0,
      turnLimit: this.turnPolicy.baseTurns,
      extensionsUsed: 0,
      turns: [],
      contextMessages: [],
      lastTurnAtMs: null,
      stopRequested: false
    };
    this.sessions.set(sessionId, created);
    this.totals.sessionsOpened += 1;
    this.enforceSessionCap(now);
    return created;
  }

  private ensureSession(sessionId: string, now: number): SessionRecord {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.updatedAtMs = now;
      existing.expiresAtMs = now + this.ttlMs;
      return existing;
    }

    this.deps.logger.warn("CONVO_SESSION_IMPLIED", "Implied conversation session from out-of-order event", {
      sessionId
    });
    return this.openSession(sessionId, now);
  }

  private addUserTurn(sessionId: string, payload: Record<string, unknown>, now: number): void {
    const text = toText(payload);
    if (!text) {
      return;
    }

    const session = this.ensureSession(sessionId, now);
    const requestedTurn = toTurn(payload);
    const nextTurn = Math.max(session.totalTurns + 1, requestedTurn ?? 0);
    session.totalTurns = nextTurn;
    session.state = "awaiting_assistant";
    session.updatedAtMs = now;
    session.expiresAtMs = now + this.ttlMs;
    session.lastTurnAtMs = now;

    session.turns.push({
      turn: nextTurn,
      userText: text,
      userAtMs: now,
      assistantText: null,
      assistantAtMs: null,
      assistantStatus: "pending"
    });

    this.pushContextMessage(session, {
      role: "user",
      text,
      atMs: now,
      turn: nextTurn
    });

    this.totals.userTurns += 1;
    this.trimTurns(session);
  }

  private attachAssistantResponse(sessionId: string, payload: Record<string, unknown>, now: number): void {
    const session = this.ensureSession(sessionId, now);
    const turn = toTurn(payload);
    const text = toText(payload);
    const target = this.findAssistantTargetTurn(session, turn);

    session.state = "agent_responding";
    session.updatedAtMs = now;
    session.expiresAtMs = now + this.ttlMs;

    if (text) {
      target.assistantText = text;
      target.assistantAtMs = now;
      this.pushContextMessage(session, {
        role: "assistant",
        text,
        atMs: now,
        turn: target.turn,
        status: "pending"
      });
    }
    target.assistantStatus = "pending";
    this.trimTurns(session);
  }

  private markAssistantStatus(sessionId: string, payload: Record<string, unknown>, now: number): void {
    const status = toSpokenStatus(payload);
    if (!status) {
      return;
    }

    const session = this.ensureSession(sessionId, now);
    const turn = toTurn(payload);
    const target = this.findAssistantTargetTurn(session, turn);

    target.assistantStatus = status;
    if (target.assistantAtMs === null) {
      target.assistantAtMs = now;
    }

    this.updateAssistantContextStatus(session, target.turn, status, now);

    session.state = "awaiting_user";
    session.updatedAtMs = now;
    session.expiresAtMs = now + this.ttlMs;
    this.totals.assistantResponses += 1;
    this.trimTurns(session);
  }

  private recordBridgeActionRequested(sessionId: string, payload: Record<string, unknown>, now: number): void {
    const action = toBridgeAction(payload.action);
    if (!action) {
      return;
    }

    const session = this.ensureSession(sessionId, now);
    const confirm = toBoolean(payload.confirm);
    const code = toActionCode(payload);

    this.pushContextMessage(session, {
      role: "system",
      text: `Action requested: ${action}`,
      atMs: now,
      status: "requested",
      action,
      code: typeof confirm === "boolean" ? `confirm_${confirm ? "yes" : "no"}` : code
    });
  }

  private recordBridgeActionBlocked(sessionId: string, payload: Record<string, unknown>, now: number): void {
    const action = toBridgeAction(payload.action);
    if (!action) {
      return;
    }

    const session = this.ensureSession(sessionId, now);
    const code = toActionCode(payload) ?? "blocked";
    const status: ConversationMessageStatus = code === "confirm_required" ? "needs_confirm" : "blocked";

    this.pushContextMessage(session, {
      role: "system",
      text: status === "needs_confirm" ? `Action needs confirmation: ${action}` : `Action blocked: ${action}`,
      atMs: now,
      status,
      action,
      code
    });
  }

  private recordBridgeActionExecuted(sessionId: string, payload: Record<string, unknown>, now: number): void {
    const action = toBridgeAction(payload.action);
    if (!action) {
      return;
    }

    const session = this.ensureSession(sessionId, now);
    const executionStatus = toActionExecutionStatus(payload) ?? "error";
    const code = toActionCode(payload) ?? (executionStatus === "ok" ? "ok" : "execution_failed");

    this.pushContextMessage(session, {
      role: "system",
      text: executionStatus === "ok" ? `Action executed: ${action}` : `Action failed: ${action}`,
      atMs: now,
      status: executionStatus === "ok" ? "executed" : "error",
      action,
      code
    });
  }

  private recordTurnLifecycle(
    sessionId: string,
    payload: Record<string, unknown>,
    now: number,
    phase: "started" | "completed"
  ): void {
    const session = this.ensureSession(sessionId, now);
    const turn = toTurn(payload) ?? undefined;

    if (phase === "started") {
      this.pushContextMessage(session, {
        role: "system",
        text: typeof turn === "number" ? `Turn ${turn} started` : "Turn started",
        atMs: now,
        turn,
        code: "turn_started"
      });
      return;
    }

    const waitResult = toWaitResult(payload) ?? "unknown";
    this.pushContextMessage(session, {
      role: "system",
      text: typeof turn === "number" ? `Turn ${turn} completed (${waitResult})` : `Turn completed (${waitResult})`,
      atMs: now,
      turn,
      code: waitResult
    });

    if (waitResult === "external_stop") {
      session.stopRequested = true;
    }
  }

  private findAssistantTargetTurn(session: SessionRecord, turn: number | null): ConversationTurnRecord {
    if (turn !== null) {
      const exact = [...session.turns].reverse().find((candidate) => candidate.turn === turn);
      if (exact) {
        return exact;
      }

      session.totalTurns = Math.max(session.totalTurns, turn);
      const created: ConversationTurnRecord = {
        turn,
        userText: null,
        userAtMs: null,
        assistantText: null,
        assistantAtMs: null,
        assistantStatus: null
      };
      session.turns.push(created);
      this.trimTurns(session);
      return created;
    }

    const pending = [...session.turns]
      .reverse()
      .find((candidate) => candidate.assistantStatus === "pending" || candidate.assistantText === null);
    if (pending) {
      return pending;
    }

    const inferredTurn = Math.max(1, session.totalTurns + 1);
    session.totalTurns = inferredTurn;
    const created: ConversationTurnRecord = {
      turn: inferredTurn,
      userText: null,
      userAtMs: null,
      assistantText: null,
      assistantAtMs: null,
      assistantStatus: null
    };
    session.turns.push(created);
    this.trimTurns(session);
    return created;
  }

  private updateAssistantContextStatus(
    session: SessionRecord,
    turn: number,
    status: SpokenStatus,
    now: number
  ): void {
    const pending = [...session.contextMessages]
      .reverse()
      .find((message) => message.role === "assistant" && message.turn === turn && message.status === "pending");

    if (pending) {
      pending.status = status;
      pending.atMs = now;
      return;
    }

    this.pushContextMessage(session, {
      role: "assistant",
      text: "Assistant response",
      atMs: now,
      turn,
      status
    });
  }

  private applyListenerTurnLimit(session: SessionRecord, payload: Record<string, unknown>): void {
    const limit = toTurnLimit(payload);
    if (limit === null) {
      return;
    }

    const clamped = Math.max(this.turnPolicy.baseTurns, Math.min(this.turnPolicy.hardCap, limit));
    session.turnLimit = clamped;
    const extra = clamped - this.turnPolicy.baseTurns;
    session.extensionsUsed = extra > 0 ? Math.ceil(extra / this.turnPolicy.extendBy) : 0;
  }

  private markSessionEnded(session: SessionRecord, now: number, reason: string): void {
    if (session.state !== "ended") {
      this.totals.sessionsEnded += 1;
      this.recordEndReason(reason);
    }

    session.state = "ended";
    session.endReason = reason;
    session.updatedAtMs = now;
    session.expiresAtMs = now + this.ttlMs;
    if (reason === "external_stop") {
      session.stopRequested = true;
    }

    this.pushContextMessage(session, {
      role: "system",
      text: `Session ended: ${reason}`,
      atMs: now,
      code: reason
    });

    this.lastEnded = {
      sessionId: session.id,
      at: formatIso(now),
      reason
    };
  }

  private pruneExpired(now: number): void {
    for (const session of this.sessions.values()) {
      if (session.expiresAtMs > now) {
        continue;
      }

      this.sessions.delete(session.id);
      this.totals.sessionsExpired += 1;
      if (session.state !== "ended") {
        this.recordEndReason("ttl_expired");
        this.lastEnded = {
          sessionId: session.id,
          at: formatIso(now),
          reason: "ttl_expired"
        };
      }
    }
  }

  private trimTurns(session: SessionRecord): void {
    while (session.turns.length > this.maxTurnsPerSession) {
      session.turns.shift();
    }
  }

  private pushContextMessage(session: SessionRecord, message: ContextMessageRecord): void {
    session.contextMessages.push(message);
    session.updatedAtMs = Math.max(session.updatedAtMs, message.atMs);
    session.expiresAtMs = session.updatedAtMs + this.ttlMs;

    while (session.contextMessages.length > this.maxContextMessagesPerSession) {
      session.contextMessages.shift();
    }
  }

  private recordEndReason(reason: string): void {
    this.endReasonCounts.set(reason, (this.endReasonCounts.get(reason) ?? 0) + 1);
  }

  private enforceSessionCap(now: number): void {
    if (this.sessions.size <= this.maxSessions) {
      return;
    }

    const candidates = [...this.sessions.values()].sort((a, b) => {
      if (a.state === "ended" && b.state !== "ended") {
        return -1;
      }
      if (a.state !== "ended" && b.state === "ended") {
        return 1;
      }
      return a.updatedAtMs - b.updatedAtMs;
    });

    while (this.sessions.size > this.maxSessions) {
      const victim = candidates.shift();
      if (!victim) {
        return;
      }
      this.sessions.delete(victim.id);
      this.totals.sessionsExpired += 1;
      if (victim.state !== "ended") {
        this.recordEndReason("capacity_pruned");
        this.lastEnded = {
          sessionId: victim.id,
          at: formatIso(now),
          reason: "capacity_pruned"
        };
      }
    }
  }

  private toContextMessage(record: ContextMessageRecord): ConversationContextMessage {
    return {
      role: record.role,
      text: record.text,
      at: formatIso(record.atMs),
      ...(typeof record.turn === "number" ? { turn: record.turn } : {}),
      ...(record.status ? { status: record.status } : {}),
      ...(record.action ? { action: record.action } : {}),
      ...(record.code ? { code: record.code } : {})
    };
  }

  private toSessionSnapshot(session: SessionRecord, now: number): ConversationSessionSnapshot {
    return {
      sessionId: session.id,
      state: session.state,
      createdAt: formatIso(session.createdAtMs),
      updatedAt: formatIso(session.updatedAtMs),
      expiresAt: formatIso(session.expiresAtMs),
      expiresInMs: Math.max(0, session.expiresAtMs - now),
      endReason: session.endReason,
      totalTurns: session.totalTurns,
      retainedTurns: session.turns.length,
      turnLimit: session.turnLimit,
      extensionsUsed: session.extensionsUsed,
      lastTurnAt: typeof session.lastTurnAtMs === "number" ? formatIso(session.lastTurnAtMs) : null,
      stopRequested: session.stopRequested,
      turns: session.turns.map((turn) => ({
        turn: turn.turn,
        userText: turn.userText,
        userAt: typeof turn.userAtMs === "number" ? formatIso(turn.userAtMs) : null,
        assistantText: turn.assistantText,
        assistantAt: typeof turn.assistantAtMs === "number" ? formatIso(turn.assistantAtMs) : null,
        assistantStatus: turn.assistantStatus
      }))
    };
  }
}
