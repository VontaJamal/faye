import type { AppEvent, EventHub } from "./events";

interface MetricsCollectorDeps {
  events: EventHub;
  maxLatencySamples?: number;
  nowMsFn?: () => number;
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

const DEFAULT_MAX_LATENCY_SAMPLES = 800;

function toSessionId(payload: Record<string, unknown>): string | null {
  const value = payload.session_id ?? payload.sessionId;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toSpokenStatus(payload: Record<string, unknown>): "ok" | "error" | "duplicate" | null {
  const status = payload.status;
  if (status === "ok" || status === "error" || status === "duplicate") {
    return status;
  }
  return null;
}

function percentile(sortedValues: number[], p: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }

  const clamped = Math.min(100, Math.max(0, p));
  const rank = Math.ceil((clamped / 100) * sortedValues.length);
  const index = Math.min(sortedValues.length - 1, Math.max(0, rank - 1));
  return sortedValues[index] ?? null;
}

export function metricsSnapshotToPrometheus(snapshot: MetricsSnapshot): string {
  const lines: string[] = [];

  lines.push(`# HELP faye_wake_detections_total Total wake detections.`);
  lines.push(`# TYPE faye_wake_detections_total counter`);
  lines.push(`faye_wake_detections_total ${snapshot.eventCounts.wakeDetections}`);

  lines.push(`# HELP faye_roundtrip_spoken_ok_total Total successful spoken acknowledgements.`);
  lines.push(`# TYPE faye_roundtrip_spoken_ok_total counter`);
  lines.push(`faye_roundtrip_spoken_ok_total ${snapshot.roundTrip.bridgeSpokenOk}`);

  lines.push(`# HELP faye_roundtrip_spoken_error_total Total failed spoken acknowledgements.`);
  lines.push(`# TYPE faye_roundtrip_spoken_error_total counter`);
  lines.push(`faye_roundtrip_spoken_error_total ${snapshot.roundTrip.bridgeSpokenError}`);

  lines.push(`# HELP faye_roundtrip_timeout_total Total round-trip watchdog timeouts.`);
  lines.push(`# TYPE faye_roundtrip_timeout_total counter`);
  lines.push(`faye_roundtrip_timeout_total ${snapshot.roundTrip.timeouts}`);

  lines.push(`# HELP faye_roundtrip_retry_total Total round-trip retries sent.`);
  lines.push(`# TYPE faye_roundtrip_retry_total counter`);
  lines.push(`faye_roundtrip_retry_total ${snapshot.roundTrip.retriesSent}`);

  lines.push(`# HELP faye_roundtrip_error_rate Error rate for round-trip sessions.`);
  lines.push(`# TYPE faye_roundtrip_error_rate gauge`);
  lines.push(`faye_roundtrip_error_rate ${snapshot.errorRate.value ?? 0}`);

  lines.push(`# HELP faye_roundtrip_latency_p95_ms P95 wake-to-spoken latency in milliseconds.`);
  lines.push(`# TYPE faye_roundtrip_latency_p95_ms gauge`);
  lines.push(`faye_roundtrip_latency_p95_ms ${snapshot.latency.p95Ms ?? 0}`);

  lines.push(`# HELP faye_roundtrip_latency_p99_ms P99 wake-to-spoken latency in milliseconds.`);
  lines.push(`# TYPE faye_roundtrip_latency_p99_ms gauge`);
  lines.push(`faye_roundtrip_latency_p99_ms ${snapshot.latency.p99Ms ?? 0}`);

  lines.push(`# HELP faye_roundtrip_active_sessions Current active tracked sessions.`);
  lines.push(`# TYPE faye_roundtrip_active_sessions gauge`);
  lines.push(`faye_roundtrip_active_sessions ${snapshot.roundTrip.activeTrackedSessions}`);

  return `${lines.join("\n")}\n`;
}

export class MetricsCollector {
  private readonly wakeStartBySession = new Map<string, number>();
  private readonly latenciesMs: number[] = [];
  private readonly maxLatencySamples: number;
  private readonly nowMsFn: () => number;
  private readonly unsubscribe: () => void;

  private readonly eventCounts = {
    wakeDetections: 0,
    messageTranscribed: 0,
    listenerErrors: 0,
    bridgeSpeakReceived: 0
  };

  private readonly roundTrip = {
    bridgeSpokenOk: 0,
    bridgeSpokenError: 0,
    bridgeSpokenDuplicate: 0,
    retriesSent: 0,
    timeouts: 0
  };

  private lastLatencyMs: number | null = null;

  constructor(deps: MetricsCollectorDeps) {
    this.maxLatencySamples = Math.max(50, deps.maxLatencySamples ?? DEFAULT_MAX_LATENCY_SAMPLES);
    this.nowMsFn = deps.nowMsFn ?? (() => Date.now());
    this.unsubscribe = deps.events.subscribe((event) => {
      this.onEvent(event);
    });
  }

  getSnapshot(): MetricsSnapshot {
    const sorted = [...this.latenciesMs].sort((a, b) => a - b);
    const p50Ms = percentile(sorted, 50);
    const p95Ms = percentile(sorted, 95);
    const p99Ms = percentile(sorted, 99);
    const maxMs = sorted.length > 0 ? (sorted[sorted.length - 1] ?? null) : null;

    const errorNumerator = this.roundTrip.bridgeSpokenError + this.roundTrip.timeouts;
    const errorDenominator = this.roundTrip.bridgeSpokenOk + this.roundTrip.bridgeSpokenError + this.roundTrip.timeouts;

    return {
      generatedAt: new Date().toISOString(),
      eventCounts: {
        ...this.eventCounts
      },
      roundTrip: {
        ...this.roundTrip,
        activeTrackedSessions: this.wakeStartBySession.size
      },
      latency: {
        samples: this.latenciesMs.length,
        lastMs: this.lastLatencyMs,
        p50Ms,
        p95Ms,
        p99Ms,
        maxMs
      },
      errorRate: {
        numerator: errorNumerator,
        denominator: errorDenominator,
        value: errorDenominator > 0 ? errorNumerator / errorDenominator : null
      }
    };
  }

  stop(): void {
    this.unsubscribe();
  }

  private onEvent(event: AppEvent): void {
    const payload = event.payload ?? {};
    const sessionId = toSessionId(payload);
    const now = this.nowMsFn();

    if (event.type === "wake_detected") {
      this.eventCounts.wakeDetections += 1;
      if (sessionId) {
        this.wakeStartBySession.set(sessionId, now);
      }
      return;
    }

    if (event.type === "message_transcribed") {
      this.eventCounts.messageTranscribed += 1;
      return;
    }

    if (event.type === "listener_error") {
      this.eventCounts.listenerErrors += 1;
      return;
    }

    if (event.type === "bridge_speak_received") {
      this.eventCounts.bridgeSpeakReceived += 1;
      return;
    }

    if (event.type === "session_retry_sent") {
      this.roundTrip.retriesSent += 1;
      return;
    }

    if (event.type === "session_timeout") {
      this.roundTrip.timeouts += 1;
      if (sessionId) {
        this.wakeStartBySession.delete(sessionId);
      }
      return;
    }

    if (event.type === "bridge_spoken") {
      const status = toSpokenStatus(payload);
      if (status === "ok") {
        this.roundTrip.bridgeSpokenOk += 1;
        if (sessionId) {
          const started = this.wakeStartBySession.get(sessionId);
          if (typeof started === "number") {
            this.recordLatency(now - started);
          }
          this.wakeStartBySession.delete(sessionId);
        }
        return;
      }

      if (status === "error") {
        this.roundTrip.bridgeSpokenError += 1;
        if (sessionId) {
          this.wakeStartBySession.delete(sessionId);
        }
        return;
      }

      if (status === "duplicate") {
        this.roundTrip.bridgeSpokenDuplicate += 1;
        if (sessionId) {
          this.wakeStartBySession.delete(sessionId);
        }
      }
    }
  }

  private recordLatency(valueMs: number): void {
    const normalized = Math.max(0, Math.round(valueMs));
    this.latenciesMs.push(normalized);
    this.lastLatencyMs = normalized;

    while (this.latenciesMs.length > this.maxLatencySamples) {
      this.latenciesMs.shift();
    }
  }
}
