import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const installShimsScript = path.resolve("scripts/install-shims.sh");

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, options);
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

test("install-shims creates faye and one-word command shims", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "faye-shims-home-"));
  const binDir = path.join(tempHome, ".local", "bin");

  const installResult = await runCommand("bash", [installShimsScript], {
    env: {
      ...process.env,
      HOME: tempHome,
      PATH: "/usr/bin:/bin"
    }
  });

  assert.equal(installResult.code, 0, installResult.stderr);
  assert.match(installResult.stdout, /Installed Faye command shims/);
  assert.match(installResult.stdout, /PATH update required/);

  const mainShim = await readFile(path.join(binDir, "faye"), "utf8");
  const openShim = await readFile(path.join(binDir, "faye-open"), "utf8");
  assert.match(mainShim, /scripts\/faye/);
  assert.match(openShim, /open/);
});

test("faye-open works from outside the repository", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "faye-shims-run-home-"));
  const outsideDir = await mkdtemp(path.join(os.tmpdir(), "faye-shims-run-cwd-"));
  const binDir = path.join(tempHome, ".local", "bin");

  const installResult = await runCommand("bash", [installShimsScript], {
    env: {
      ...process.env,
      HOME: tempHome
    }
  });
  assert.equal(installResult.code, 0, installResult.stderr);

  const openResult = await runCommand("faye-open", ["--print"], {
    cwd: outsideDir,
    env: {
      ...process.env,
      HOME: tempHome,
      PATH: `${binDir}:${process.env.PATH ?? ""}`
    }
  });

  assert.equal(openResult.code, 0, openResult.stderr);
  assert.equal(openResult.stdout.trim(), "http://127.0.0.1:4587");
});
