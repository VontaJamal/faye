import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const cliPath = path.resolve("dist/app/cli.js");

async function runCli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
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

async function makeMockBinary(dir: string, name: string, body: string): Promise<void> {
  const target = path.join(dir, name);
  await fs.writeFile(target, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, "utf8");
  await fs.chmod(target, 0o755);
}

async function makeMockScript(filePath: string, body: string): Promise<void> {
  await fs.writeFile(filePath, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, "utf8");
  await fs.chmod(filePath, 0o755);
}

test("cli preflight supports env overrides", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "faye-cli-preflight-"));

  const result = await runCli(["preflight", "--json"], {
    FAYE_PREFLIGHT_REQUIRED_COMMANDS: "node",
    FAYE_PREFLIGHT_WRITABLE_PATHS: tempDir,
    FAYE_PREFLIGHT_MIC_COMMAND: "node"
  });

  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.requiredCommands.node, true);
});

test("cli setup non-interactive returns deterministic missing fields code", async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "faye-cli-setup-"));

  const result = await runCli(["setup", "--non-interactive", "--api-key", "test-key"], {
    HOME: tempHome,
    FAYE_RUNTIME_CONFIG: path.join(tempHome, "runtime.json"),
    FAYE_VOICE_CONFIG: path.join(tempHome, "legacy.json")
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /E_SETUP_NON_INTERACTIVE_MISSING_FIELDS/);
});

test("cli first-success writes install-attempt report in non-interactive smoke mode", async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "faye-cli-first-success-"));
  const mockBin = path.join(tempHome, "mock-bin");
  await fs.mkdir(mockBin, { recursive: true });

  await makeMockBinary(
    mockBin,
    "uname",
    `echo "Darwin"`
  );

  await makeMockBinary(
    mockBin,
    "launchctl",
    `if [[ "\${1:-}" == "list" ]]; then
  exit 0
fi
exit 0`
  );

  await makeMockBinary(
    mockBin,
    "rec",
    `exit 0`
  );

  const secretsDir = path.join(tempHome, ".openclaw", "secrets");
  await fs.mkdir(secretsDir, { recursive: true });
  const apiKeyPath = path.join(secretsDir, "elevenlabs-api-key.txt");
  await fs.writeFile(apiKeyPath, "test-key\n", "utf8");
  await fs.chmod(apiKeyPath, 0o600);

  const result = await runCli(["first-success", "--skip-speak"], {
    HOME: tempHome,
    PATH: `${mockBin}:${process.env.PATH ?? ""}`,
    FAYE_RUNTIME_CONFIG: path.join(tempHome, "runtime.json"),
    FAYE_VOICE_CONFIG: path.join(tempHome, "legacy.json")
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /First-success: PASS/);

  const reportLine = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("Report:"));

  assert.ok(reportLine);
  const reportPath = reportLine.replace(/^Report:\s*/, "");
  const reportRaw = await fs.readFile(reportPath, "utf8");
  const report = JSON.parse(reportRaw);

  assert.equal(report.source, "faye-first-success");
  assert.equal(report.success, true);
  assert.equal(Array.isArray(report.steps), true);
});

test("cli open --print returns dashboard url", async () => {
  const result = await runCli(["open", "--print"]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.trim(), "http://127.0.0.1:4587");
});

test("cli panic runs panic-stop flow with typed confirmation", async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "faye-cli-panic-"));
  const tempScripts = path.join(tempHome, "mock-control");
  await fs.mkdir(tempScripts, { recursive: true });

  const listenerControl = path.join(tempScripts, "listener-control.sh");
  const bridgeControl = path.join(tempScripts, "bridge-control.sh");
  const dashboardControl = path.join(tempScripts, "dashboard-control.sh");

  await makeMockScript(listenerControl, "echo listener stopped");
  await makeMockScript(bridgeControl, "echo bridge stopped");
  await makeMockScript(dashboardControl, "echo dashboard stopped");

  const reportsDir = path.join(tempHome, ".faye", "reports");
  await fs.mkdir(reportsDir, { recursive: true });

  const result = await runCli(["panic", "--confirm", "PANIC STOP", "--json"], {
    HOME: tempHome,
    FAYE_LISTENER_CONTROL_SCRIPT: listenerControl,
    FAYE_BRIDGE_CONTROL_SCRIPT: bridgeControl,
    FAYE_DASHBOARD_CONTROL_SCRIPT: dashboardControl,
    FAYE_REPORTS_DIR: reportsDir,
    FAYE_RUNTIME_CONFIG: path.join(tempHome, "runtime.json"),
    FAYE_VOICE_CONFIG: path.join(tempHome, "legacy.json")
  });

  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.result.action, "panic-stop");
});
