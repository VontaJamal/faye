import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const installScript = path.resolve("scripts/install.sh");

function runInstall(env = {}) {
  return new Promise((resolve) => {
    const child = spawn("bash", [installScript], {
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
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function extractReportPath(output) {
  const match = output.match(/Install report:\s*(.+)/);
  return match?.[1]?.trim() ?? null;
}

test("install script writes structured report in test mode", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "faye-install-test-"));

  const result = await runInstall({
    HOME: tempHome,
    FAYE_INSTALL_TEST_MODE: "1",
    FAYE_INSTALL_SKIP_NPM: "1",
    FAYE_INSTALL_SKIP_DOCTOR: "1",
    FAYE_PREFLIGHT_REQUIRED_COMMANDS: "node",
    FAYE_PREFLIGHT_MIC_COMMAND: "node",
    FAYE_PREFLIGHT_WRITABLE_PATHS: `${tempHome}/.openclaw,${path.resolve('.faye/reports')}`
  });

  assert.equal(result.code, 0);
  const reportPath = extractReportPath(result.stdout);
  assert.ok(reportPath);

  const reportRaw = await readFile(reportPath, "utf8");
  const report = JSON.parse(reportRaw);
  assert.equal(report.source, "install.sh");
  assert.equal(report.success, true);
  assert.equal(Array.isArray(report.steps), true);
});

test("install script fails fast when preflight dependency check fails", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "faye-install-fail-"));

  const result = await runInstall({
    HOME: tempHome,
    FAYE_INSTALL_TEST_MODE: "1",
    FAYE_INSTALL_SKIP_NPM: "1",
    FAYE_INSTALL_SKIP_DOCTOR: "1",
    FAYE_PREFLIGHT_REQUIRED_COMMANDS: "definitely-missing-command",
    FAYE_PREFLIGHT_MIC_COMMAND: "definitely-missing-command",
    FAYE_PREFLIGHT_WRITABLE_PATHS: `${tempHome}/.openclaw,${path.resolve('.faye/reports')}`
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stdout, /preflight checks failed/i);

  const reportPath = extractReportPath(result.stdout);
  assert.ok(reportPath);

  const reportRaw = await readFile(reportPath, "utf8");
  const report = JSON.parse(reportRaw);
  assert.equal(report.success, false);
  assert.equal(report.steps.some((step) => step.code === "E_PREFLIGHT_FAILED"), true);
});
