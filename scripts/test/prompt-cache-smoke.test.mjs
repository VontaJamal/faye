import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import path from "node:path";

const scriptPath = path.resolve("scripts/prompt-cache-smoke.sh");

function runSmoke(env = {}) {
  return new Promise((resolve) => {
    const child = spawn("bash", [scriptPath], {
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

async function startServer(responseFactory) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const bodyRaw = Buffer.concat(chunks).toString("utf8");
      const body = bodyRaw ? JSON.parse(bodyRaw) : {};
      requests.push(body);

      const next = responseFactory(requests.length, body);
      res.writeHead(next.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(next.body));
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("E_PROMPT_CACHE_SMOKE_TEST_BIND");
  }

  return {
    url: `http://127.0.0.1:${address.port}/v1/responses`,
    requests,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

test("prompt-cache smoke passes when second request reports cached tokens", async () => {
  const server = await startServer((count) => {
    if (count === 1) {
      return {
        body: {
          id: "resp-1",
          usage: {
            input_tokens: 1500,
            input_tokens_details: { cached_tokens: 0 },
          },
        },
      };
    }

    return {
      body: {
        id: "resp-2",
        usage: {
          input_tokens: 900,
          input_tokens_details: { cached_tokens: 650 },
        },
      },
    };
  });

  try {
    const result = await runSmoke({
      FAYE_PROMPT_CACHE_SMOKE_URL: server.url,
      FAYE_PROMPT_CACHE_SMOKE_AUTH_TOKEN: "test-token",
      FAYE_PROMPT_CACHE_SMOKE_MODEL: "openai/gpt-5-mini",
      FAYE_PROMPT_CACHE_SMOKE_CACHE_KEY: "shadow-smoke-test-key",
      FAYE_PROMPT_CACHE_SMOKE_RETENTION: "in_memory",
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /PROMPT_CACHE_SMOKE_PASS/);

    assert.equal(server.requests.length, 2);
    assert.equal(server.requests[0].prompt_cache_key, "shadow-smoke-test-key");
    assert.equal(server.requests[1].prompt_cache_key, "shadow-smoke-test-key");
    assert.equal(server.requests[0].prompt_cache_retention, "in_memory");
    assert.equal(server.requests[1].prompt_cache_retention, "in_memory");
  } finally {
    await server.close();
  }
});

test("prompt-cache smoke fails when second request has no cached tokens", async () => {
  const server = await startServer(() => ({
    body: {
      id: "resp-no-cache",
      usage: {
        input_tokens: 1200,
        input_tokens_details: { cached_tokens: 0 },
      },
    },
  }));

  try {
    const result = await runSmoke({
      FAYE_PROMPT_CACHE_SMOKE_URL: server.url,
      FAYE_PROMPT_CACHE_SMOKE_AUTH_TOKEN: "test-token",
      FAYE_PROMPT_CACHE_SMOKE_MODEL: "openai/gpt-5-mini",
    });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /E_PROMPT_CACHE_SMOKE_CACHE_MISS/);
  } finally {
    await server.close();
  }
});
