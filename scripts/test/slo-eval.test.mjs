import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const scriptPath = path.resolve("scripts/slo-eval.sh");

function runSloEval(env = {}) {
  return new Promise((resolve) => {
    const child = spawn("bash", [scriptPath], {
      env: {
        ...process.env,
        ...env
      }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}

function snapshot({ spokenOk, p95, p99, errorRate }) {
  return {
    roundTrip: {
      bridgeSpokenOk: spokenOk
    },
    latency: {
      p95Ms: p95,
      p99Ms: p99
    },
    errorRate: {
      value: errorRate
    }
  };
}

async function writeJson(baseDir, name, value) {
  const filePath = path.join(baseDir, name);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

test("slo-eval passes with healthy metrics", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "faye-slo-pass-"));
  const baselinePath = await writeJson(tempDir, "baseline.json", snapshot({ spokenOk: 4, p95: 900, p99: 1700, errorRate: 0.01 }));
  const currentPath = await writeJson(tempDir, "current.json", snapshot({ spokenOk: 5, p95: 1200, p99: 2100, errorRate: 0.01 }));

  const result = await runSloEval({
    FAYE_METRICS_JSON_PATH: currentPath,
    FAYE_METRICS_BASELINE_PATH: baselinePath
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /SLO_EVAL_PASS/);
});

test("slo-eval fails when error rate exceeds threshold", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "faye-slo-error-rate-"));
  const baselinePath = await writeJson(tempDir, "baseline.json", snapshot({ spokenOk: 1, p95: 600, p99: 1200, errorRate: 0.0 }));
  const currentPath = await writeJson(tempDir, "current.json", snapshot({ spokenOk: 2, p95: 1000, p99: 1800, errorRate: 0.03 }));

  const result = await runSloEval({
    FAYE_METRICS_JSON_PATH: currentPath,
    FAYE_METRICS_BASELINE_PATH: baselinePath
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /error rate exceeds threshold/i);
});

test("slo-eval fails when p95 exceeds threshold", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "faye-slo-p95-"));
  const baselinePath = await writeJson(tempDir, "baseline.json", snapshot({ spokenOk: 8, p95: 700, p99: 1500, errorRate: 0.0 }));
  const currentPath = await writeJson(tempDir, "current.json", snapshot({ spokenOk: 9, p95: 2601, p99: 3000, errorRate: 0.0 }));

  const result = await runSloEval({
    FAYE_METRICS_JSON_PATH: currentPath,
    FAYE_METRICS_BASELINE_PATH: baselinePath
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /p95 latency exceeds threshold/i);
});

test("slo-eval fails when p99 exceeds threshold", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "faye-slo-p99-"));
  const baselinePath = await writeJson(tempDir, "baseline.json", snapshot({ spokenOk: 8, p95: 700, p99: 1500, errorRate: 0.0 }));
  const currentPath = await writeJson(tempDir, "current.json", snapshot({ spokenOk: 9, p95: 1400, p99: 5300, errorRate: 0.0 }));

  const result = await runSloEval({
    FAYE_METRICS_JSON_PATH: currentPath,
    FAYE_METRICS_BASELINE_PATH: baselinePath
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /p99 latency exceeds threshold/i);
});

test("slo-eval fails when spoken success count does not increase", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "faye-slo-spoken-"));
  const baselinePath = await writeJson(tempDir, "baseline.json", snapshot({ spokenOk: 5, p95: 600, p99: 1100, errorRate: 0.0 }));
  const currentPath = await writeJson(tempDir, "current.json", snapshot({ spokenOk: 5, p95: 900, p99: 1800, errorRate: 0.0 }));

  const result = await runSloEval({
    FAYE_METRICS_JSON_PATH: currentPath,
    FAYE_METRICS_BASELINE_PATH: baselinePath
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /spoken success count did not increase/i);
});
