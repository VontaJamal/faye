import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { UxKpiTracker } from "../ux-kpi";

function sequentialClock(startMs = 1_700_000_000_000): () => Date {
  let tick = 0;
  return () => {
    const value = new Date(startMs + tick * 1_000);
    tick += 1;
    return value;
  };
}

test("ux-kpi tracker writes mode 0600 and computes first-success latency", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "faye-ux-kpi-"));
  try {
    const reportPath = path.join(tempDir, "ui-kpi.json");
    const tracker = new UxKpiTracker({ reportPath, nowFn: sequentialClock() });

    await tracker.recordSetupAttempt();
    await tracker.recordSetupSuccess();
    await tracker.recordVoiceTestAttempt();
    await tracker.recordVoiceTestSuccess();

    const report = await tracker.getReport();
    const stats = await fs.stat(reportPath);

    assert.equal(stats.mode & 0o777, 0o600);
    assert.equal(report.counters.setupAttempts, 1);
    assert.equal(report.counters.setupSuccesses, 1);
    assert.equal(report.counters.voiceTestAttempts, 1);
    assert.equal(report.counters.voiceTestSuccesses, 1);
    assert.equal(typeof report.firstSetupAt, "string");
    assert.equal(typeof report.firstVoiceSuccessAt, "string");
    assert.equal(report.timeToFirstSuccessMs, 2_000);
    assert.equal(report.lastVoiceTestOk, true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("ux-kpi tracker bounds recent failure history", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "faye-ux-kpi-"));
  try {
    const reportPath = path.join(tempDir, "ui-kpi.json");
    const tracker = new UxKpiTracker({ reportPath, nowFn: sequentialClock() });

    for (let index = 0; index < 25; index += 1) {
      await tracker.recordBridgeRestartFailure(`failure-${index}`);
    }

    const report = await tracker.getReport();
    assert.equal(report.counters.bridgeRestartFailures, 25);
    assert.equal(report.recentFailures.length, 20);
    assert.equal(report.recentFailures[0]?.error, "failure-24");
    assert.equal(report.recentFailures[19]?.error, "failure-5");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
