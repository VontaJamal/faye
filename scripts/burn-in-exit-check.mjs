#!/usr/bin/env node
import fs from "node:fs";

const token = process.env.GITHUB_TOKEN ?? "";
const repo = process.env.GITHUB_REPOSITORY ?? "";
const apiBaseUrl = process.env.GITHUB_API_BASE_URL ?? "https://api.github.com";
const issueNumber = Number(process.env.BURN_IN_ISSUE_NUMBER ?? "3");
const startDate = process.env.BURN_IN_START_DATE ?? "2026-02-21";
const endDate = process.env.BURN_IN_END_DATE ?? "2026-02-27";
const metricsPath = process.env.BURN_IN_METRICS_JSON_PATH ?? "";
const metricsUrl = process.env.BURN_IN_METRICS_URL ?? "http://127.0.0.1:4587/v1/metrics";
const outPath = process.env.BURN_IN_EXIT_REPORT_PATH ?? "";

function fail(message, details = {}) {
  const payload = {
    ok: false,
    message,
    details
  };
  if (outPath) {
    fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
  console.error(`BURN_IN_EXIT_FAIL: ${message}`);
  if (Object.keys(details).length > 0) {
    console.error(JSON.stringify(details, null, 2));
  }
  process.exit(1);
}

function pass(summary) {
  const payload = {
    ok: true,
    ...summary
  };
  if (outPath) {
    fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
  console.log("BURN_IN_EXIT_PASS");
  console.log(JSON.stringify(payload, null, 2));
}

function isoDatesInRange(start, end) {
  const list = [];
  let cursor = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);

  if (!Number.isFinite(cursor) || !Number.isFinite(endMs) || cursor > endMs) {
    return list;
  }

  while (cursor <= endMs) {
    list.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 86_400_000;
  }

  return list;
}

async function githubGet(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    fail("GitHub API request failed", {
      url,
      status: response.status,
      body
    });
  }

  return response.json();
}

async function fetchAllIssueComments(owner, name, issue) {
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = `${apiBaseUrl}/repos/${owner}/${name}/issues/${issue}/comments?per_page=100&page=${page}`;
    const batch = await githubGet(url);
    if (!Array.isArray(batch)) {
      fail("Unexpected issue comments response shape", { url });
    }
    all.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }
  return all;
}

function parsePassDates(comments) {
  const regex = /Burn-in day\s+passed\s*:?\s*(\d{4}-\d{2}-\d{2})/gi;
  const dates = new Set();

  for (const comment of comments) {
    const body = typeof comment.body === "string" ? comment.body : "";
    let match;
    while ((match = regex.exec(body)) !== null) {
      dates.add(match[1]);
    }
  }

  return dates;
}

async function fetchOpenSev1Issues(owner, name) {
  const sev1 = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = `${apiBaseUrl}/repos/${owner}/${name}/issues?state=open&labels=sev-1&per_page=100&page=${page}`;
    const batch = await githubGet(url);
    if (!Array.isArray(batch)) {
      fail("Unexpected sev-1 issue response shape", { url });
    }
    sev1.push(...batch.filter((item) => !item.pull_request));
    if (batch.length < 100) {
      break;
    }
  }
  return sev1;
}

async function readMetrics() {
  if (metricsPath) {
    if (!fs.existsSync(metricsPath)) {
      fail("Metrics JSON file not found", { metricsPath });
    }
    try {
      return JSON.parse(fs.readFileSync(metricsPath, "utf8"));
    } catch (error) {
      fail("Unable to parse metrics JSON", {
        metricsPath,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const response = await fetch(metricsUrl, { method: "GET" });
  if (!response.ok) {
    fail("Unable to fetch metrics URL", {
      metricsUrl,
      status: response.status
    });
  }

  try {
    return await response.json();
  } catch (error) {
    fail("Unable to parse metrics response", {
      metricsUrl,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function main() {
  if (!repo.includes("/")) {
    fail("GITHUB_REPOSITORY must be owner/repo", { repo });
  }

  if (!token) {
    fail("GITHUB_TOKEN is required");
  }

  const requiredDates = isoDatesInRange(startDate, endDate);
  if (requiredDates.length === 0) {
    fail("Invalid burn-in date range", { startDate, endDate });
  }

  const [owner, name] = repo.split("/");
  const [comments, sev1Issues, metrics] = await Promise.all([
    fetchAllIssueComments(owner, name, issueNumber),
    fetchOpenSev1Issues(owner, name),
    readMetrics()
  ]);

  const passDates = parsePassDates(comments);
  const missingDates = requiredDates.filter((date) => !passDates.has(date));

  const errorRate = Number(metrics?.errorRate?.value ?? NaN);
  const p95 = Number(metrics?.latency?.p95Ms ?? NaN);
  const p99 = Number(metrics?.latency?.p99Ms ?? NaN);
  const rollingSuccess = Number.isFinite(errorRate) ? 1 - errorRate : NaN;

  const summary = {
    generatedAt: new Date().toISOString(),
    requiredDates,
    passDates: [...passDates].sort(),
    missingDates,
    unresolvedSev1Count: sev1Issues.length,
    metrics: {
      rollingSuccess,
      errorRate,
      p95,
      p99
    }
  };

  if (missingDates.length > 0) {
    fail("Not all burn-in days are marked as passed", summary);
  }

  if (sev1Issues.length > 0) {
    fail("Unresolved sev-1 issues remain", summary);
  }

  if (!Number.isFinite(rollingSuccess) || rollingSuccess < 0.98) {
    fail("Round-trip success is below 98%", summary);
  }

  if (!Number.isFinite(p95) || p95 > 2500) {
    fail("p95 latency target not met", summary);
  }

  if (!Number.isFinite(p99) || p99 > 5000) {
    fail("p99 latency target not met", summary);
  }

  pass(summary);
}

main().catch((error) => {
  fail("Unhandled error in burn-in exit check", {
    message: error instanceof Error ? error.message : String(error)
  });
});
