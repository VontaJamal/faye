import { UX_KPI_REPORT_PATH } from "./paths";
import type { UxKpiReport } from "./types";
import { readUxKpiReport, writeUxKpiReport } from "./utils";

type FailureAction = "setup" | "voice-test" | "listener-restart" | "bridge-restart";

interface UxKpiTrackerOptions {
  reportPath?: string;
  nowFn?: () => Date;
}

const MAX_FAILURES = 20;

function emptyReport(nowIso: string): UxKpiReport {
  return {
    schemaVersion: 1,
    generatedAt: nowIso,
    firstSetupAt: null,
    firstVoiceSuccessAt: null,
    lastVoiceTestAt: null,
    lastVoiceTestOk: null,
    timeToFirstSuccessMs: null,
    counters: {
      setupAttempts: 0,
      setupSuccesses: 0,
      setupFailures: 0,
      listenerRestartAttempts: 0,
      listenerRestartFailures: 0,
      bridgeRestartAttempts: 0,
      bridgeRestartFailures: 0,
      voiceTestAttempts: 0,
      voiceTestSuccesses: 0,
      voiceTestFailures: 0
    },
    recentFailures: []
  };
}

function toIso(nowFn: () => Date): string {
  return nowFn().toISOString();
}

function toSafeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, 280) || "unknown";
}

function computeTimeToFirstSuccess(report: UxKpiReport): number | null {
  if (!report.firstSetupAt || !report.firstVoiceSuccessAt) {
    return null;
  }

  const setupMs = Date.parse(report.firstSetupAt);
  const firstVoiceMs = Date.parse(report.firstVoiceSuccessAt);
  if (!Number.isFinite(setupMs) || !Number.isFinite(firstVoiceMs)) {
    return null;
  }

  return Math.max(0, Math.round(firstVoiceMs - setupMs));
}

function pushFailure(report: UxKpiReport, action: FailureAction, error: unknown, at: string): void {
  report.recentFailures.unshift({
    at,
    action,
    error: toSafeMessage(error)
  });

  if (report.recentFailures.length > MAX_FAILURES) {
    report.recentFailures.splice(MAX_FAILURES);
  }
}

export class UxKpiTracker {
  private readonly reportPath: string;
  private readonly nowFn: () => Date;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: UxKpiTrackerOptions = {}) {
    this.reportPath = options.reportPath ?? UX_KPI_REPORT_PATH;
    this.nowFn = options.nowFn ?? (() => new Date());
  }

  async getReport(): Promise<UxKpiReport> {
    await this.writeQueue;
    return this.loadReport();
  }

  async recordSetupAttempt(): Promise<void> {
    await this.mutate((report, nowIso) => {
      report.generatedAt = nowIso;
      report.counters.setupAttempts += 1;
    });
  }

  async recordSetupSuccess(): Promise<void> {
    await this.mutate((report, nowIso) => {
      report.generatedAt = nowIso;
      report.counters.setupSuccesses += 1;
      if (report.firstSetupAt === null) {
        report.firstSetupAt = nowIso;
      }
      report.timeToFirstSuccessMs = computeTimeToFirstSuccess(report);
    });
  }

  async recordSetupFailure(error: unknown): Promise<void> {
    await this.mutate((report, nowIso) => {
      report.generatedAt = nowIso;
      report.counters.setupFailures += 1;
      pushFailure(report, "setup", error, nowIso);
    });
  }

  async recordListenerRestartAttempt(): Promise<void> {
    await this.mutate((report, nowIso) => {
      report.generatedAt = nowIso;
      report.counters.listenerRestartAttempts += 1;
    });
  }

  async recordListenerRestartFailure(error: unknown): Promise<void> {
    await this.mutate((report, nowIso) => {
      report.generatedAt = nowIso;
      report.counters.listenerRestartFailures += 1;
      pushFailure(report, "listener-restart", error, nowIso);
    });
  }

  async recordBridgeRestartAttempt(): Promise<void> {
    await this.mutate((report, nowIso) => {
      report.generatedAt = nowIso;
      report.counters.bridgeRestartAttempts += 1;
    });
  }

  async recordBridgeRestartFailure(error: unknown): Promise<void> {
    await this.mutate((report, nowIso) => {
      report.generatedAt = nowIso;
      report.counters.bridgeRestartFailures += 1;
      pushFailure(report, "bridge-restart", error, nowIso);
    });
  }

  async recordVoiceTestAttempt(): Promise<void> {
    await this.mutate((report, nowIso) => {
      report.generatedAt = nowIso;
      report.counters.voiceTestAttempts += 1;
      report.lastVoiceTestAt = nowIso;
    });
  }

  async recordVoiceTestSuccess(): Promise<void> {
    await this.mutate((report, nowIso) => {
      report.generatedAt = nowIso;
      report.counters.voiceTestSuccesses += 1;
      report.lastVoiceTestAt = nowIso;
      report.lastVoiceTestOk = true;
      if (report.firstVoiceSuccessAt === null) {
        report.firstVoiceSuccessAt = nowIso;
      }
      report.timeToFirstSuccessMs = computeTimeToFirstSuccess(report);
    });
  }

  async recordVoiceTestFailure(error: unknown): Promise<void> {
    await this.mutate((report, nowIso) => {
      report.generatedAt = nowIso;
      report.counters.voiceTestFailures += 1;
      report.lastVoiceTestAt = nowIso;
      report.lastVoiceTestOk = false;
      pushFailure(report, "voice-test", error, nowIso);
    });
  }

  private async mutate(mutator: (report: UxKpiReport, nowIso: string) => void): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const report = await this.loadReport();
      const nowIso = toIso(this.nowFn);
      mutator(report, nowIso);
      await writeUxKpiReport(this.reportPath, report);
    });

    await this.writeQueue;
  }

  private async loadReport(): Promise<UxKpiReport> {
    const existing = await readUxKpiReport(this.reportPath);
    if (existing) {
      return existing;
    }

    const report = emptyReport(toIso(this.nowFn));
    await writeUxKpiReport(this.reportPath, report);
    return report;
  }
}
