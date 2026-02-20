import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import path from "node:path";

const scriptPath = path.resolve("scripts/burn-in-gate-check.mjs");

async function startApiServer(comments) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/repos/acme/faye/issues/3/comments") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(comments));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "not found" }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("E_TEST_SERVER_BIND_FAILED");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    }
  };
}

function runGate(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
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

function marker(body, updatedAt) {
  return {
    id: Math.floor(Math.random() * 10_000),
    body,
    html_url: "https://example.test/comment/1",
    created_at: updatedAt,
    updated_at: updatedAt,
    user: {
      login: "tester"
    }
  };
}

async function runWithComments(comments) {
  const server = await startApiServer(comments);
  try {
    return await runGate({
      GITHUB_TOKEN: "test-token",
      GITHUB_REPOSITORY: "acme/faye",
      BURN_IN_ISSUE_NUMBER: "3",
      BURN_IN_DATE_UTC: "2026-02-22",
      BURN_IN_START_DATE: "2026-02-21",
      BURN_IN_END_DATE: "2026-02-27",
      BURN_IN_ENFORCE_OUTSIDE_WINDOW: "1",
      GITHUB_API_BASE_URL: server.baseUrl
    });
  } finally {
    await server.close();
  }
}

test("burn-in gate passes when same-day pass marker exists", async () => {
  const result = await runWithComments([
    marker("Burn-in day passed: 2026-02-22", "2026-02-22T13:00:00Z")
  ]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /BURN_IN_GATE_PASS/);
});

test("burn-in gate fails when marker is stale", async () => {
  const result = await runWithComments([
    marker("Burn-in day passed: 2026-02-21", "2026-02-22T13:00:00Z")
  ]);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /stale/i);
});

test("burn-in gate fails when latest marker is failure", async () => {
  const result = await runWithComments([
    marker("Burn-in day passed: 2026-02-22", "2026-02-22T10:00:00Z"),
    marker("Burn-in day failed: 2026-02-22", "2026-02-22T14:00:00Z")
  ]);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /latest burn-in marker is failed/i);
});

test("burn-in gate fails when no marker comment exists", async () => {
  const result = await runWithComments([
    marker("No burn-in status in this comment", "2026-02-22T14:00:00Z")
  ]);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /no burn-in marker comments found/i);
});
