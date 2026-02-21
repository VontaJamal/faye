import fs from "node:fs/promises";
import path from "node:path";

import {
  BRIDGE_OFFSET_PATH,
  BRIDGE_PROCESSED_KEYS_PATH,
  BRIDGE_RUNTIME_STATUS_PATH
} from "./paths";
import { ensureDir, pathExists, writeJsonAtomic } from "./utils";

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

interface ProcessedKeyStore {
  order: string[];
  set: Set<string>;
}

const PROCESSED_KEYS_LIMIT = 2500;
let processedKeysCache: ProcessedKeyStore | null = null;
let runtimeCache: BridgeRuntimeStatus | null = null;

export async function readOffset(): Promise<number> {
  if (!(await pathExists(BRIDGE_OFFSET_PATH))) {
    return 0;
  }

  const raw = (await fs.readFile(BRIDGE_OFFSET_PATH, "utf8")).trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export async function writeOffset(offset: number): Promise<void> {
  await ensureDir(path.dirname(BRIDGE_OFFSET_PATH));
  await fs.writeFile(BRIDGE_OFFSET_PATH, `${offset}\n`, { mode: 0o600 });
  await fs.chmod(BRIDGE_OFFSET_PATH, 0o600);
}

function defaultRuntimeStatus(): BridgeRuntimeStatus {
  return {
    state: "starting",
    updatedAt: new Date().toISOString(),
    consecutiveErrors: 0,
    backoffMs: 2000
  };
}

function normalizeRuntimeStatus(input: unknown): BridgeRuntimeStatus {
  const raw = input && typeof input === "object" ? (input as Partial<BridgeRuntimeStatus>) : {};
  const now = new Date().toISOString();

  return {
    state:
      raw.state === "starting" || raw.state === "idle" || raw.state === "processing" || raw.state === "error"
        ? raw.state
        : "starting",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
    consecutiveErrors: Number.isFinite(raw.consecutiveErrors) ? Math.max(0, Number(raw.consecutiveErrors)) : 0,
    backoffMs: Number.isFinite(raw.backoffMs) ? Math.max(500, Number(raw.backoffMs)) : 2000,
    lastErrorAt: typeof raw.lastErrorAt === "string" ? raw.lastErrorAt : undefined,
    lastError: typeof raw.lastError === "string" ? raw.lastError : undefined,
    lastSuccessAt: typeof raw.lastSuccessAt === "string" ? raw.lastSuccessAt : undefined,
    lastOffset: Number.isFinite(raw.lastOffset) ? Number(raw.lastOffset) : undefined,
    lastUpdateId: Number.isFinite(raw.lastUpdateId) ? Number(raw.lastUpdateId) : undefined,
    lastCommandType: typeof raw.lastCommandType === "string" ? raw.lastCommandType : undefined,
    lastCommandStatus:
      raw.lastCommandStatus === "ok" || raw.lastCommandStatus === "error" || raw.lastCommandStatus === "duplicate"
        ? raw.lastCommandStatus
        : undefined
  };
}

export async function loadRuntimeStatus(): Promise<BridgeRuntimeStatus> {
  if (runtimeCache) {
    return runtimeCache;
  }

  if (!(await pathExists(BRIDGE_RUNTIME_STATUS_PATH))) {
    runtimeCache = defaultRuntimeStatus();
    return runtimeCache;
  }

  try {
    const raw = await fs.readFile(BRIDGE_RUNTIME_STATUS_PATH, "utf8");
    runtimeCache = normalizeRuntimeStatus(JSON.parse(raw) as unknown);
    return runtimeCache;
  } catch {
    runtimeCache = defaultRuntimeStatus();
    return runtimeCache;
  }
}

async function persistRuntimeStatus(status: BridgeRuntimeStatus): Promise<void> {
  await writeJsonAtomic(BRIDGE_RUNTIME_STATUS_PATH, status, 0o600);
}

export async function updateRuntimeStatus(patch: Partial<BridgeRuntimeStatus>): Promise<void> {
  const current = await loadRuntimeStatus();
  runtimeCache = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await persistRuntimeStatus(runtimeCache);
}

export async function readBridgeRuntimeStatus(): Promise<BridgeRuntimeStatus | null> {
  if (!(await pathExists(BRIDGE_RUNTIME_STATUS_PATH))) {
    return null;
  }

  try {
    const raw = await fs.readFile(BRIDGE_RUNTIME_STATUS_PATH, "utf8");
    return normalizeRuntimeStatus(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

async function loadProcessedKeyStore(): Promise<ProcessedKeyStore> {
  if (processedKeysCache) {
    return processedKeysCache;
  }

  if (!(await pathExists(BRIDGE_PROCESSED_KEYS_PATH))) {
    processedKeysCache = { order: [], set: new Set() };
    return processedKeysCache;
  }

  try {
    const raw = await fs.readFile(BRIDGE_PROCESSED_KEYS_PATH, "utf8");
    const parsed = JSON.parse(raw) as { keys?: string[] };
    const keys = Array.isArray(parsed.keys) ? parsed.keys.filter((item) => typeof item === "string") : [];
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const key of keys) {
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(key);
      }
    }
    const trimmed = deduped.slice(-PROCESSED_KEYS_LIMIT);
    processedKeysCache = {
      order: trimmed,
      set: new Set(trimmed)
    };
    return processedKeysCache;
  } catch {
    processedKeysCache = { order: [], set: new Set() };
    return processedKeysCache;
  }
}

async function persistProcessedKeyStore(store: ProcessedKeyStore): Promise<void> {
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    keys: store.order
  };
  await writeJsonAtomic(BRIDGE_PROCESSED_KEYS_PATH, payload, 0o600);
}

export async function hasProcessedCommandKey(key: string): Promise<boolean> {
  const store = await loadProcessedKeyStore();
  return store.set.has(key);
}

export async function markProcessedCommandKey(key: string): Promise<void> {
  const store = await loadProcessedKeyStore();
  if (store.set.has(key)) {
    return;
  }

  store.order.push(key);
  store.set.add(key);

  while (store.order.length > PROCESSED_KEYS_LIMIT) {
    const removed = store.order.shift();
    if (removed) {
      store.set.delete(removed);
    }
  }

  await persistProcessedKeyStore(store);
}
