import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

const scriptPath = path.resolve("scripts/prompt-cache-contract-check.sh");

function runScript(args = [], env = {}) {
  return new Promise((resolve) => {
    const child = spawn("bash", [scriptPath, ...args], {
      env: {
        ...process.env,
        ...env,
      },
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

test("prompt-cache contract check passes with repository defaults", async () => {
  const result = await runScript();
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Prompt cache contract checks passed\./);
});

test("prompt-cache contract check fails when strict dependent config is requested but missing", async () => {
  const result = await runScript(["--strict-dependent", "--dependent-config", "/tmp/faye-missing-openclaw-config.json"]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /E_PROMPT_CACHE_DEPENDENT_CONFIG_MISSING/);
});
