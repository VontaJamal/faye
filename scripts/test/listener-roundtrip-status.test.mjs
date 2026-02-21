import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import path from "node:path";

const listenerScript = path.resolve("scripts/listener.sh");

function runListenerRoundTripWait(baseUrl, sessionId, timeoutSeconds = 3) {
  return new Promise((resolve) => {
    const child = spawn("bash", [listenerScript], {
      env: {
        ...process.env,
        FAYE_LISTENER_TEST_ROUNDTRIP_MODE: "1",
        FAYE_LISTENER_TEST_SESSION_ID: sessionId,
        FAYE_LISTENER_TEST_TIMEOUT_SECONDS: String(timeoutSeconds),
        FAYE_LOCAL_API_BASE_URL: baseUrl
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

test("listener wait uses lightweight roundtrip status endpoint", async () => {
  const paths = [];
  let attempts = 0;

  const server = http.createServer((req, res) => {
    paths.push(req.url ?? "");
    if (req.url === "/v1/roundtrip/s-wait-1/status") {
      attempts += 1;
      const pending = attempts < 3;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          sessionId: "s-wait-1",
          pending,
          state: pending ? "awaiting_speak" : null,
          retryCount: 0,
          updatedAt: pending ? new Date().toISOString() : null
        })
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not-found" }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("E_LISTENER_WAIT_TEST_ADDRESS");
  }

  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const result = await runListenerRoundTripWait(baseUrl, "s-wait-1", 5);
  server.close();
  await once(server, "close");

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /ROUNDTRIP_WAIT_OK/);
  assert.equal(paths.some((entry) => entry === "/v1/health"), false);
  assert.equal(paths.some((entry) => entry === "/v1/roundtrip/s-wait-1/status"), true);
});

test("listener wait ignores mismatched session payload until matching session completes", async () => {
  let attempts = 0;

  const server = http.createServer((req, res) => {
    if (req.url === "/v1/roundtrip/s-wait-mismatch/status") {
      attempts += 1;
      const body =
        attempts === 1
          ? {
              sessionId: "wrong-session",
              pending: false,
              state: null,
              retryCount: 0,
              updatedAt: null
            }
          : {
              sessionId: "s-wait-mismatch",
              pending: false,
              state: null,
              retryCount: 0,
              updatedAt: null
            };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not-found" }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("E_LISTENER_WAIT_TEST_ADDRESS");
  }

  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const result = await runListenerRoundTripWait(baseUrl, "s-wait-mismatch", 5);
  server.close();
  await once(server, "close");

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /ROUNDTRIP_WAIT_OK/);
  assert.equal(attempts >= 2, true);
});

test("listener wait accepts compacted-whitespace payload when pending flips false", async () => {
  let attempts = 0;

  const server = http.createServer((req, res) => {
    if (req.url === "/v1/roundtrip/s-wait-whitespace/status") {
      attempts += 1;
      res.writeHead(200, { "Content-Type": "application/json" });

      if (attempts < 2) {
        res.end(`{
  "sessionId" : "s-wait-whitespace",
  "pending" : true,
  "state" : "awaiting_speak",
  "retryCount" : 0,
  "updatedAt" : "${new Date().toISOString()}"
}`);
        return;
      }

      res.end(`{
  "sessionId" : "s-wait-whitespace",
  "pending" : false,
  "state" : null,
  "retryCount" : 0,
  "updatedAt" : null
}`);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not-found" }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("E_LISTENER_WAIT_TEST_ADDRESS");
  }

  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const result = await runListenerRoundTripWait(baseUrl, "s-wait-whitespace", 5);
  server.close();
  await once(server, "close");

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /ROUNDTRIP_WAIT_OK/);
  assert.equal(attempts >= 2, true);
});

test("listener wait times out when session stays pending", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/v1/roundtrip/s-wait-timeout/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          sessionId: "s-wait-timeout",
          pending: true,
          state: "awaiting_speak",
          retryCount: 1,
          updatedAt: new Date().toISOString()
        })
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not-found" }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("E_LISTENER_WAIT_TEST_ADDRESS");
  }

  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const result = await runListenerRoundTripWait(baseUrl, "s-wait-timeout", 1);
  server.close();
  await once(server, "close");

  assert.notEqual(result.code, 0);
  assert.match(result.stdout, /ROUNDTRIP_WAIT_TIMEOUT/);
});
