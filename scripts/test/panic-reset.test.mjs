import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, access, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const panicResetScript = path.resolve("scripts/panic-reset.sh");

function runScript(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn("bash", [panicResetScript, ...args], {
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

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("panic-reset requires exact typed confirmation", async () => {
  const result = await runScript(["panic-stop", "--confirm", "wrong phrase", "--json"]);
  assert.notEqual(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, "E_PANIC_CONFIRMATION_REQUIRED");
});

test("factory-reset archives diagnostics and wipes state paths", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "faye-panic-reset-"));
  const openclawDir = path.join(tempHome, ".openclaw");
  const stateDir = path.join(openclawDir, "faye-voice");
  const secretsDir = path.join(openclawDir, "secrets");
  const reportsDir = path.join(tempHome, ".faye", "reports");
  const controlDir = path.join(tempHome, "control");
  const runtimeConfigPath = path.join(openclawDir, "faye-runtime-config.json");
  const legacyConfigPath = path.join(openclawDir, "faye-voice-config.json");

  await mkdir(stateDir, { recursive: true });
  await mkdir(secretsDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });
  await mkdir(controlDir, { recursive: true });

  await writeFile(runtimeConfigPath, JSON.stringify({ ok: true }), "utf8");
  await writeFile(legacyConfigPath, JSON.stringify({ ok: true }), "utf8");
  await writeFile(path.join(secretsDir, "elevenlabs-api-key.txt"), "key\n", "utf8");
  await writeFile(path.join(stateDir, "telegram-bridge-runtime.json"), "{}", "utf8");
  await writeFile(path.join(reportsDir, "ui-kpi.json"), "{}", "utf8");

  const listenerControl = path.join(controlDir, "listener-control.sh");
  const bridgeControl = path.join(controlDir, "bridge-control.sh");
  const dashboardControl = path.join(controlDir, "dashboard-control.sh");
  await writeFile(listenerControl, "#!/usr/bin/env bash\nset -euo pipefail\necho listener-stopped\n", "utf8");
  await writeFile(bridgeControl, "#!/usr/bin/env bash\nset -euo pipefail\necho bridge-stopped\n", "utf8");
  await writeFile(dashboardControl, "#!/usr/bin/env bash\nset -euo pipefail\necho dashboard-stopped\n", "utf8");
  await Promise.all([chmod(listenerControl, 0o755), chmod(bridgeControl, 0o755), chmod(dashboardControl, 0o755)]);

  const result = await runScript(["factory-reset", "--confirm", "FACTORY RESET", "--json"], {
    HOME: tempHome,
    FAYE_OPENCLAW_DIR: openclawDir,
    FAYE_STATE_DIR: stateDir,
    FAYE_SECRETS_DIR: secretsDir,
    FAYE_REPORTS_DIR: reportsDir,
    FAYE_RUNTIME_CONFIG: runtimeConfigPath,
    FAYE_VOICE_CONFIG: legacyConfigPath,
    FAYE_LISTENER_CONTROL_SCRIPT: listenerControl,
    FAYE_BRIDGE_CONTROL_SCRIPT: bridgeControl,
    FAYE_DASHBOARD_CONTROL_SCRIPT: dashboardControl
  });

  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.result.action, "factory-reset");
  assert.equal(typeof payload.result.archivePath, "string");
  assert.equal(await fileExists(payload.result.archivePath), true);
  assert.equal(await fileExists(runtimeConfigPath), false);
  assert.equal(await fileExists(legacyConfigPath), false);
  assert.equal(await fileExists(secretsDir), false);
  assert.equal(await fileExists(stateDir), false);
  assert.equal(await fileExists(reportsDir), false);
});
