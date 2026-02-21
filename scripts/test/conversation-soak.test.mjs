import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const scriptPath = path.resolve("scripts/conversation-soak.mjs");

function runSoak(args = []) {
  return new Promise((resolve) => {
    const child = spawn("node", [scriptPath, ...args], {
      env: {
        ...process.env
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

test("conversation soak writes deterministic report and passes thresholds", async () => {
  const reportDir = await mkdtemp(path.join(os.tmpdir(), "faye-soak-report-"));
  const result = await runSoak(["--sessions=6", "--turns=2", `--report-dir=${reportDir}`, "--json"]);

  assert.equal(result.code, 0, result.stderr || result.stdout);

  const files = (await readdir(reportDir)).filter((file) => file.startsWith("conversation-soak-") && file.endsWith(".json"));
  assert.equal(files.length, 1);

  const reportPath = path.join(reportDir, files[0]);
  const report = JSON.parse(await readFile(reportPath, "utf8"));

  assert.equal(report.pass, true);
  assert.equal(report.counters.sessions.requested, 6);
  assert.equal(report.counters.sessions.completed, 6);
  assert.equal(report.counters.turns.requested, 12);
  assert.equal(report.health.roundTripTimeouts, 0);
  assert.equal(report.health.bridgeSpokenError, 0);
  assert.equal(report.health.activeSessions, 0);
  assert.equal(report.counters.actions.impactfulBlocked >= 1, true);
  assert.equal(report.counters.actions.impactfulConfirmed >= 1, true);
});
