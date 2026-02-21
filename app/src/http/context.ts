import type { Response } from "express";

import type { ConversationSessionManager } from "../conversationSessionManager";
import type { EventHub } from "../events";
import type { ElevenLabsClient } from "../elevenlabs";
import type { Logger } from "../logger";
import type { MetricsCollector } from "../metrics";
import type { RoundTripCoordinator } from "../roundTripCoordinator";
import type { ServiceControl } from "../service-control";
import type { ConfigStore } from "../store";
import type { UxKpiTracker } from "../ux-kpi";

export interface ApiDependencies {
  store: ConfigStore;
  events: EventHub;
  logger: Logger;
  elevenLabs: ElevenLabsClient;
  services: ServiceControl;
  uxKpi?: UxKpiTracker;
  conversationStopRequestPath?: string;
  systemPaths?: {
    openclawDir?: string;
    secretsDir?: string;
    stateDir?: string;
    runtimeConfigPath?: string;
    legacyConfigPath?: string;
    reportsDir?: string;
  };
}

export interface RecoveryPaths {
  openclawDir: string;
  secretsDir: string;
  stateDir: string;
  runtimeConfigPath: string;
  legacyConfigPath: string;
  reportsDir: string;
}

export interface SessionEndResult {
  endedSessionId: string | null;
  stopRequestWritten: boolean;
}

export interface ApiRouteContext {
  deps: ApiDependencies;
  roundTrip: RoundTripCoordinator;
  metrics: MetricsCollector;
  conversation: ConversationSessionManager;
  uxKpi: UxKpiTracker;
  stopRequestPath: string;
  recoveryPaths: RecoveryPaths;
  recordUxKpi: (operation: string, callback: () => Promise<void>) => Promise<void>;
  normalizeReason: (value: unknown, fallback: string) => string;
  normalizeOptional: (value: unknown) => string | undefined;
  parseContextLimit: (value: unknown) => number;
  parseIncludePending: (value: unknown) => boolean;
  ensureConfirmation: (actual: string, expected: string, code: string) => void;
  speakWithProfile: (text: string, profileId?: string) => Promise<{ profileId: string }>;
  endActiveSessionForRecovery: (requestedReason: string) => Promise<SessionEndResult>;
  clearVolatileRuntimeFiles: () => Promise<string[]>;
  archiveDiagnostics: (archivePath: string) => Promise<string[]>;
  wipeFactoryResetTargets: () => Promise<string[]>;
}

export type RouteErrorHandler = (res: Response, error: unknown) => void;
