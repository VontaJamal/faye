#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    url: process.env.FAYE_PROMPT_CACHE_BASELINE_URL || "https://api.openai.com/v1/responses",
    model: process.env.FAYE_PROMPT_CACHE_BASELINE_MODEL || "gpt-5-mini",
    runs: Number(process.env.FAYE_PROMPT_CACHE_BASELINE_RUNS || 6),
    outDir: process.env.FAYE_PROMPT_CACHE_BASELINE_OUT_DIR || ".faye/reports",
    token: process.env.FAYE_PROMPT_CACHE_BASELINE_AUTH_TOKEN || process.env.OPENAI_API_KEY || "",
    cacheKey:
      process.env.FAYE_PROMPT_CACHE_BASELINE_CACHE_KEY ||
      `shadow-prompt-cache-baseline-${new Date().toISOString().slice(0, 10)}`,
    retention: process.env.FAYE_PROMPT_CACHE_BASELINE_RETENTION || "in_memory",
    maxOutputTokens: Number(process.env.FAYE_PROMPT_CACHE_BASELINE_MAX_OUTPUT_TOKENS || 160)
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const [flag, inlineValue] = token.includes("=") ? token.split(/=(.+)/, 2) : [token, undefined];
    const value = inlineValue ?? argv[i + 1];

    switch (flag) {
      case "--url":
        args.url = String(value || args.url);
        if (!inlineValue) i += 1;
        break;
      case "--model":
        args.model = String(value || args.model);
        if (!inlineValue) i += 1;
        break;
      case "--runs":
        args.runs = Number(value || args.runs);
        if (!inlineValue) i += 1;
        break;
      case "--out-dir":
        args.outDir = String(value || args.outDir);
        if (!inlineValue) i += 1;
        break;
      case "--token":
        args.token = String(value || args.token);
        if (!inlineValue) i += 1;
        break;
      case "--cache-key":
        args.cacheKey = String(value || args.cacheKey);
        if (!inlineValue) i += 1;
        break;
      case "--retention":
        args.retention = String(value || args.retention);
        if (!inlineValue) i += 1;
        break;
      case "--max-output-tokens":
        args.maxOutputTokens = Number(value || args.maxOutputTokens);
        if (!inlineValue) i += 1;
        break;
      default:
        break;
    }
  }

  return args;
}

function buildPrefix() {
  const parts = [];
  for (let i = 0; i < 480; i += 1) {
    parts.push(`Shadow cache baseline block ${i + 1}. Keep this static for cache reuse.`);
  }
  return parts.join(" ");
}

function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function extractUsage(payload) {
  const usage = payload && typeof payload === "object" ? payload.usage ?? {} : {};
  const input = toNumber(usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens);
  const output = toNumber(usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens);

  const details = usage.input_tokens_details ?? usage.prompt_tokens_details ?? usage.inputTokensDetails ?? {};
  const cached = toNumber(details.cached_tokens ?? usage.cached_tokens ?? usage.cachedTokens);

  return {
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: cached
  };
}

async function run() {
  const args = parseArgs(process.argv);

  if (!args.token) {
    throw new Error("Missing auth token. Set OPENAI_API_KEY or FAYE_PROMPT_CACHE_BASELINE_AUTH_TOKEN.");
  }

  if (!Number.isInteger(args.runs) || args.runs < 2) {
    throw new Error("--runs must be an integer >= 2.");
  }

  const prefix = buildPrefix();
  const runDetails = [];

  for (let i = 0; i < args.runs; i += 1) {
    const prompt = `${prefix}\n\nTask: respond with one sentence confirming cache baseline run ${i + 1}.`;

    const payload = {
      model: args.model,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt
            }
          ]
        }
      ],
      max_output_tokens: args.maxOutputTokens,
      prompt_cache_key: args.cacheKey,
      prompt_cache_retention: args.retention,
      metadata: {
        probe: "faye_prompt_cache_baseline_v1",
        run: i + 1
      }
    };

    const startedAt = Date.now();
    const response = await fetch(args.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${args.token}`
      },
      body: JSON.stringify(payload)
    });

    const latencyMs = Date.now() - startedAt;
    const bodyText = await response.text();

    let body = {};
    try {
      body = JSON.parse(bodyText);
    } catch {
      // keep body as object fallback
    }

    if (!response.ok) {
      throw new Error(`Request ${i + 1} failed (${response.status}): ${bodyText.slice(0, 500)}`);
    }

    runDetails.push({
      run: i + 1,
      status: response.status,
      latencyMs,
      ...extractUsage(body)
    });
  }

  const latencies = runDetails.map((r) => r.latencyMs);
  const totalInputTokens = runDetails.reduce((sum, r) => sum + r.inputTokens, 0);
  const totalCachedInputTokens = runDetails.reduce((sum, r) => sum + r.cachedInputTokens, 0);

  const report = {
    generatedAt: new Date().toISOString(),
    profile: {
      model: args.model,
      url: args.url,
      runs: args.runs,
      retention: args.retention,
      cacheKey: args.cacheKey
    },
    summary: {
      totalInputTokens,
      totalCachedInputTokens,
      cachedInputShare:
        totalInputTokens + totalCachedInputTokens > 0
          ? Number((totalCachedInputTokens / (totalInputTokens + totalCachedInputTokens)).toFixed(4))
          : 0,
      latency: {
        p50Ms: percentile(latencies, 50),
        p95Ms: percentile(latencies, 95)
      }
    },
    runs: runDetails
  };

  await mkdir(args.outDir, { recursive: true });
  const filePath = path.join(args.outDir, `prompt-cache-baseline-${Date.now()}.json`);
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Prompt cache baseline report: ${filePath}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

run().catch((error) => {
  console.error(`E_PROMPT_CACHE_BASELINE_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
