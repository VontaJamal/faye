export function readPositiveEnvInt(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw || !/^\d+$/.test(raw)) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function normalizeOptional(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeReason(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .slice(0, 80);

  return normalized.length > 0 ? normalized : fallback;
}

export function parseContextLimit(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    return 8;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    return 8;
  }

  return Math.max(1, Math.min(16, parsed));
}

export function parseIncludePending(value: unknown): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") {
    return true;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }

  return true;
}

function normalizeConfirmation(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

export function ensureConfirmation(actual: string, expected: string, code: string): void {
  if (normalizeConfirmation(actual) !== expected) {
    throw new Error(code);
  }
}
