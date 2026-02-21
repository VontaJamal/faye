import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

function runScript(scriptPath, args = [], env = {}) {
  return new Promise((resolve) => {
    const child = spawn("bash", [scriptPath, ...args], {
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

async function createMockBin() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "faye-control-mock-"));
  const binDir = path.join(tempDir, "bin");
  await mkdir(binDir, { recursive: true });

  await writeFile(
    path.join(binDir, "uname"),
    "#!/usr/bin/env bash\nset -euo pipefail\necho Linux\n",
    "utf8"
  );

  await writeFile(
    path.join(binDir, "systemctl"),
    "#!/usr/bin/env bash\nset -euo pipefail\necho systemctl:$*\nexit 0\n",
    "utf8"
  );
  await chmod(path.join(binDir, "uname"), 0o755);
  await chmod(path.join(binDir, "systemctl"), 0o755);

  return binDir;
}

test("control scripts call systemctl in Linux mode", async () => {
  const mockBin = await createMockBin();

  const scripts = [
    { file: path.resolve("scripts/listener-control.sh"), service: "faye-voice-listener.service" },
    { file: path.resolve("scripts/dashboard-control.sh"), service: "faye-voice-dashboard.service" },
    { file: path.resolve("scripts/telegram-bridge-control.sh"), service: "faye-voice-telegram-bridge.service" }
  ];

  for (const script of scripts) {
    const result = await runScript(script.file, ["status"], {
      PATH: `${mockBin}:${process.env.PATH ?? ""}`
    });

    assert.equal(result.code, 0, `${script.file} failed: ${result.stderr}`);
    assert.match(result.stdout, new RegExp(`systemctl:--user status ${script.service} --no-pager`));
  }
});

test("control scripts reject invalid action", async () => {
  const script = path.resolve("scripts/listener-control.sh");
  const result = await runScript(script, ["invalid-action"]);

  assert.notEqual(result.code, 0);
  assert.match(result.stdout + result.stderr, /Usage:/);
});
