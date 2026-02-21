import type { BridgeActionName, ConversationTurnPolicy } from "./types";

const DEFAULT_CONTEXT_LIMIT = 8;
export const MAX_CONTEXT_LIMIT = 16;

export const DEFAULT_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_MAX_TURNS_PER_SESSION = 16;
export const DEFAULT_MAX_SESSIONS = 24;
export const DEFAULT_MAX_CONTEXT_MESSAGES = 160;
export const DEFAULT_TURN_POLICY: ConversationTurnPolicy = {
  baseTurns: 8,
  extendBy: 4,
  hardCap: 16
};

export function formatIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function toSessionId(payload: Record<string, unknown>): string | null {
  const value = payload.session_id ?? payload.sessionId;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toText(payload: Record<string, unknown>): string | null {
  const value = payload.text;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toTurn(payload: Record<string, unknown>): number | null {
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

export function toSpokenStatus(payload: Record<string, unknown>): "ok" | "error" | "duplicate" | null {
  const status = payload.status;
  if (status === "ok" || status === "error" || status === "duplicate") {
    return status;
  }
  return null;
}

export function toListenerStatus(payload: Record<string, unknown>): string | null {
  const status = payload.status;
  if (typeof status !== "string") {
    return null;
  }
  const normalized = status.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeReason(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").slice(0, 80);
  return normalized.length > 0 ? normalized : undefined;
}

export function toReason(payload: Record<string, unknown>): string | undefined {
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

export function toTurnLimit(payload: Record<string, unknown>): number | null {
  const maxTurns = payload.max_turns ?? payload.maxTurns;
  return toPositiveInt(maxTurns);
}

export function clampTurnPolicy(input: Partial<ConversationTurnPolicy> | undefined): ConversationTurnPolicy {
  const baseTurns = Math.max(1, Math.min(32, Math.floor(input?.baseTurns ?? DEFAULT_TURN_POLICY.baseTurns)));
  const extendBy = Math.max(1, Math.min(16, Math.floor(input?.extendBy ?? DEFAULT_TURN_POLICY.extendBy)));
  const hardCapRaw = Math.max(1, Math.min(64, Math.floor(input?.hardCap ?? DEFAULT_TURN_POLICY.hardCap)));
  const hardCap = Math.max(baseTurns, hardCapRaw);
  return { baseTurns, extendBy, hardCap };
}

export function toBridgeAction(value: unknown): BridgeActionName | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    text === "health_summary" ||
    text === "voice_test" ||
    text === "listener_restart" ||
    text === "bridge_restart"
  ) {
    return text;
  }
  return null;
}

export function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "yes" || normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "no" || normalized === "false" || normalized === "0") {
      return false;
    }
  }
  return null;
}

export function toActionCode(payload: Record<string, unknown>): string | undefined {
  const fromCode = normalizeReason(payload.code);
  if (fromCode) {
    return fromCode;
  }
  return normalizeReason(payload.reason);
}

export function toActionExecutionStatus(payload: Record<string, unknown>): "ok" | "error" | null {
  const status = payload.status;
  if (status === "ok" || status === "error") {
    return status;
  }
  return null;
}

export function toWaitResult(payload: Record<string, unknown>): string | undefined {
  return normalizeReason(payload.wait_result ?? payload.waitResult);
}

export function clampContextLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CONTEXT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_CONTEXT_LIMIT, Math.floor(value)));
}
