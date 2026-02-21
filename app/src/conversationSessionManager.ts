import type { AppEvent, EventHub } from "./events";
import type { Logger } from "./logger";
import type { ConversationTurnPolicy } from "./types";

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

interface ConversationSessionManagerDeps {
  events: EventHub;
  logger: Logger;
  ttlMs?: number;
  maxTurnsPerSession?: number;
  maxSessions?: number;
  turnPolicy?: Partial<ConversationTurnPolicy>;
  nowMsFn?: () => number;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_TURNS_PER_SESSION = 16;
const DEFAULT_MAX_SESSIONS = 24;
const DEFAULT_TURN_POLICY: ConversationTurnPolicy = {
  baseTurns: 8,
  extendBy: 4,
  hardCap: 16
};

function formatIso(ms: number): string {
  return new Date(ms).toISOString();
}

function toSessionId(payload: Record<string, unknown>): string | null {
  const value = payload.session_id ?? payload.sessionId;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toText(payload: Record<string, unknown>): string | null {
  const value = payload.text;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toTurn(payload: Record<string, unknown>): number | null {
  const value = payload.turn;
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 500) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 500) {
      return parsed;
    }
  }
  return null;
}

function toSpokenStatus(payload: Record<string, unknown>): SpokenStatus | null {
  const status = payload.status;
  if (status === "ok" || status === "error" || status === "duplicate") {
    return status;
  }
  return null;
}

function toListenerStatus(payload: Record<string, unknown>): string | null {
  const status = payload.status;
  if (typeof status !== "string") {
    return null;
  }
  const normalized = status.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function toReason(payload: Record<string, unknown>): string | undefined {
  return normalizeReason(payload.reason);
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function toTurnLimit(payload: Record<string, unknown>): number | null {
  const maxTurns = payload.max_turns ?? payload.maxTurns;
  return toPositiveInt(maxTurns);
}

function normalizeReason(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").slice(0, 80);
  return normalized.length > 0 ? normalized : undefined;
}

function clampTurnPolicy(input: Partial<ConversationTurnPolicy> | undefined): ConversationTurnPolicy {
  const baseTurns = Math.max(1, Math.min(32, Math.floor(input?.baseTurns ?? DEFAULT_TURN_POLICY.baseTurns)));
  const extendBy = Math.max(1, Math.min(16, Math.floor(input?.extendBy ?? DEFAULT_TURN_POLICY.extendBy)));
  const hardCapRaw = Math.max(1, Math.min(64, Math.floor(input?.hardCap ?? DEFAULT_TURN_POLICY.hardCap)));
  const hardCap = Math.max(baseTurns, hardCapRaw);
  return { baseTurns, extendBy, hardCap };
}

export class ConversationSessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly ttlMs: number;
  private readonly maxTurnsPerSession: number;
  private readonly maxSessions: number;
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

    const ordered = [...this.sessions.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);

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

  endSession(sessionId: string, reason: string): ConversationSessionSnapshot | null {
    const now = this.nowMsFn();
    this.pruneExpired(now);
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    this.markSessionEnded(session, now, normalizeReason(reason) ?? "manual_terminated");
    return this.toSessionSnapshot(session, now);
  }

  private handleEvent(event: AppEvent): void {
    const now = this.nowMsFn();
    this.pruneExpired(now);
    const payload = event.payload ?? {};
    const sessionId = toSessionId(payload);

    if (event.type === "wake_detected" && sessionId) {
      this.openSession(sessionId, now);
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

    if (event.type === "listener_status" && sessionId) {
      const status = toListenerStatus(payload);
      if (!status) {
        return;
      }

      if (status === "conversation_loop_started" || status === "conversation_started") {
        const session = this.openSession(sessionId, now);
        this.applyListenerTurnLimit(session, payload);
        return;
      }

      if (status === "conversation_loop_extended") {
        const session = this.ensureSession(sessionId, now);
        this.applyListenerTurnLimit(session, payload);
        return;
      }

      if (status === "conversation_loop_ended" || status === "conversation_ended") {
        const session = this.sessions.get(sessionId);
        if (session) {
          this.markSessionEnded(session, now, toReason(payload) ?? "listener_ended");
        }
      }
    }
  }

  private openSession(sessionId: string, now: number): SessionRecord {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.state = "awaiting_user";
      existing.endReason = undefined;
      existing.updatedAtMs = now;
      existing.expiresAtMs = now + this.ttlMs;
      existing.turnLimit = this.turnPolicy.baseTurns;
      existing.extensionsUsed = 0;
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
      turns: []
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

    session.turns.push({
      turn: nextTurn,
      userText: text,
      userAtMs: now,
      assistantText: null,
      assistantAtMs: null,
      assistantStatus: "pending"
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

    session.state = "awaiting_user";
    session.updatedAtMs = now;
    session.expiresAtMs = now + this.ttlMs;
    this.totals.assistantResponses += 1;
    this.trimTurns(session);
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

  private recordEndReason(reason: string): void {
    this.endReasonCounts.set(reason, (this.endReasonCounts.get(reason) ?? 0) + 1);
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
