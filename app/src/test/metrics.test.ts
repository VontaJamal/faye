import assert from "node:assert/strict";
import test from "node:test";

import { EventHub } from "../events";
import { MetricsCollector, metricsSnapshotToPrometheus } from "../metrics";

test("metrics collector tracks wake-to-spoken latency and counters", () => {
  const events = new EventHub();
  let now = 1_000;
  const metrics = new MetricsCollector({
    events,
    nowMsFn: () => now
  });

  events.publish("wake_detected", { session_id: "s-1" });
  now += 180;
  events.publish("bridge_spoken", { session_id: "s-1", status: "ok" });

  const snapshot = metrics.getSnapshot();
  metrics.stop();

  assert.equal(snapshot.eventCounts.wakeDetections, 1);
  assert.equal(snapshot.roundTrip.bridgeSpokenOk, 1);
  assert.equal(snapshot.latency.samples, 1);
  assert.equal(snapshot.latency.lastMs, 180);
  assert.equal(snapshot.latency.p95Ms, 180);
  assert.equal(snapshot.errorRate.denominator, 1);
  assert.equal(snapshot.errorRate.numerator, 0);
  assert.equal(snapshot.errorRate.value, 0);
});

test("metrics collector computes error rate with spoken errors and timeouts", () => {
  const events = new EventHub();
  const metrics = new MetricsCollector({
    events
  });

  events.publish("bridge_spoken", { session_id: "s-err", status: "error" });
  events.publish("session_timeout", { session_id: "s-timeout" });
  events.publish("bridge_spoken", { session_id: "s-ok", status: "ok" });

  const snapshot = metrics.getSnapshot();
  const prom = metricsSnapshotToPrometheus(snapshot);
  metrics.stop();

  assert.equal(snapshot.roundTrip.bridgeSpokenError, 1);
  assert.equal(snapshot.roundTrip.timeouts, 1);
  assert.equal(snapshot.roundTrip.bridgeSpokenOk, 1);
  assert.equal(snapshot.errorRate.denominator, 3);
  assert.equal(snapshot.errorRate.numerator, 2);
  assert.equal(snapshot.errorRate.value !== null && snapshot.errorRate.value > 0.66, true);
  assert.equal(prom.includes("faye_roundtrip_error_rate"), true);
});
