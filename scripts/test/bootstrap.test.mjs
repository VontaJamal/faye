import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const bootstrapScript = path.resolve("scripts/bootstrap.sh");

function runCommand(cmd, args, cwd, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: {
        ...process.env,
        ...extraEnv
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

async function createFixtureRepo(baseDir) {
  const repoDir = path.join(baseDir, "fixture-source-repo");
  await mkdir(path.join(repoDir, "scripts"), { recursive: true });

  await writeFile(
    path.join(repoDir, "scripts", "install.sh"),
    "#!/usr/bin/env bash\nset -euo pipefail\necho install-ok\n",
    "utf8"
  );

  const chmodResult = await runCommand("chmod", ["+x", "scripts/install.sh"], repoDir);
  assert.equal(chmodResult.code, 0);

  let result = await runCommand("git", ["init", "-b", "main"], repoDir);
  assert.equal(result.code, 0, result.stderr);

  result = await runCommand("git", ["config", "user.email", "test@example.com"], repoDir);
  assert.equal(result.code, 0);

  result = await runCommand("git", ["config", "user.name", "Faye Test"], repoDir);
  assert.equal(result.code, 0);

  result = await runCommand("git", ["add", "."], repoDir);
  assert.equal(result.code, 0);

  result = await runCommand("git", ["commit", "-m", "initial"], repoDir);
  assert.equal(result.code, 0, result.stderr);

  return repoDir;
}

test("bootstrap handles target path with spaces", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "faye-bootstrap-space-"));
  const repoDir = await createFixtureRepo(tempDir);
  const targetDir = path.join(tempDir, "target dir with spaces");

  const result = await runCommand(
    "bash",
    [bootstrapScript],
    path.resolve("."),
    {
      FAYE_REPO_URL: repoDir,
      FAYE_BRANCH: "main",
      FAYE_INSTALL_DIR: targetDir
    }
  );

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Bootstrap complete\./);

  const installedScript = await readFile(path.join(targetDir, "scripts", "install.sh"), "utf8");
  assert.match(installedScript, /install-ok/);
});

test("bootstrap updates existing clone on second run", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "faye-bootstrap-update-"));
  const repoDir = await createFixtureRepo(tempDir);
  const targetDir = path.join(tempDir, "target-repo");

  let result = await runCommand(
    "bash",
    [bootstrapScript],
    path.resolve("."),
    {
      FAYE_REPO_URL: repoDir,
      FAYE_BRANCH: "main",
      FAYE_INSTALL_DIR: targetDir
    }
  );
  assert.equal(result.code, 0, result.stderr);

  await writeFile(path.join(repoDir, "CHANGE.txt"), "updated\n", "utf8");
  result = await runCommand("git", ["add", "CHANGE.txt"], repoDir);
  assert.equal(result.code, 0, result.stderr);
  result = await runCommand("git", ["commit", "-m", "update"], repoDir);
  assert.equal(result.code, 0, result.stderr);

  result = await runCommand(
    "bash",
    [bootstrapScript],
    path.resolve("."),
    {
      FAYE_REPO_URL: repoDir,
      FAYE_BRANCH: "main",
      FAYE_INSTALL_DIR: targetDir
    }
  );

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Updating Faye source/);

  const updatedFile = await readFile(path.join(targetDir, "CHANGE.txt"), "utf8");
  assert.equal(updatedFile.trim(), "updated");
});
