#!/usr/bin/env node
import fs from "node:fs";

const token = process.env.GITHUB_TOKEN ?? "";
const repo = process.env.GITHUB_REPOSITORY ?? "";
const issueNumber = Number(process.env.BURN_IN_ISSUE_NUMBER ?? "3");
const apiBaseUrl = process.env.GITHUB_API_BASE_URL ?? "https://api.github.com";
const startDate = process.env.BURN_IN_START_DATE ?? "2026-02-21";
const endDate = process.env.BURN_IN_END_DATE ?? "2026-02-27";
const enforceOutsideWindow = (process.env.BURN_IN_ENFORCE_OUTSIDE_WINDOW ?? "0") === "1";
const targetDate = process.env.BURN_IN_DATE_UTC ?? new Date().toISOString().slice(0, 10);
const outPath = process.env.BURN_IN_GATE_OUT_PATH ?? "";

function fail(message, details = {}) {
  const payload = {
    ok: false,
    message,
    details,
    targetDate,
    issueNumber,
    repository: repo
  };
  if (outPath) {
    fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
  console.error(`BURN_IN_GATE_FAIL: ${message}`);
  if (Object.keys(details).length > 0) {
    console.error(JSON.stringify(details, null, 2));
  }
  process.exit(1);
}

function pass(message, details = {}) {
  const payload = {
    ok: true,
    message,
    details,
    targetDate,
    issueNumber,
    repository: repo
  };
  if (outPath) {
    fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
  console.log("BURN_IN_GATE_PASS");
  console.log(JSON.stringify(payload, null, 2));
}

function isDateInRange(date, start, end) {
  return date >= start && date <= end;
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

function parseMarkerEntries(comments) {
  const markerRegex = /Burn-in day\s+(passed|failed)\s*:?\s*(\d{4}-\d{2}-\d{2})/gi;
  const entries = [];

  for (const comment of comments) {
    const body = typeof comment.body === "string" ? comment.body : "";
    let match;
    while ((match = markerRegex.exec(body)) !== null) {
      entries.push({
        status: match[1].toLowerCase() === "passed" ? "pass" : "fail",
        date: match[2],
        commentId: comment.id,
        htmlUrl: comment.html_url,
        updatedAt: comment.updated_at,
        createdAt: comment.created_at,
        author: comment.user?.login ?? "unknown"
      });
    }
  }

  entries.sort((a, b) => {
    const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? "");
    const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? "");
    return bTime - aTime;
  });

  return entries;
}

async function fetchAllIssueComments(owner, name, issue) {
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = `${apiBaseUrl}/repos/${owner}/${name}/issues/${issue}/comments?per_page=100&page=${page}`;
    const batch = await githubGet(url);
    if (!Array.isArray(batch)) {
      fail("Unexpected GitHub API response shape for issue comments", { url });
    }
    all.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }
  return all;
}

async function main() {
  if (!repo.includes("/")) {
    fail("GITHUB_REPOSITORY must be set to owner/repo", { repo });
  }

  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    fail("BURN_IN_ISSUE_NUMBER must be a positive integer", { issueNumber });
  }

  if (!isDateInRange(targetDate, startDate, endDate) && !enforceOutsideWindow) {
    pass("Outside burn-in window; gate check skipped", {
      startDate,
      endDate
    });
    return;
  }

  if (!token) {
    fail("GITHUB_TOKEN is required for burn-in gate check");
  }

  const [owner, name] = repo.split("/");
  const comments = await fetchAllIssueComments(owner, name, issueNumber);
  const entries = parseMarkerEntries(comments);

  if (entries.length === 0) {
    fail("No burn-in marker comments found on issue", {
      issueNumber,
      requiredPattern: "Burn-in day passed: YYYY-MM-DD"
    });
  }

  const latest = entries[0];
  if (!latest) {
    fail("Unable to read latest burn-in marker entry");
  }

  if (latest.status === "fail") {
    fail("Latest burn-in marker is failed", {
      latest
    });
  }

  if (latest.date !== targetDate) {
    fail("Latest burn-in marker is stale", {
      latest,
      requiredDate: targetDate
    });
  }

  pass("Same-day burn-in pass marker found", {
    latest,
    markerCount: entries.length
  });
}

main().catch((error) => {
  fail("Unhandled error while evaluating burn-in gate", {
    message: error instanceof Error ? error.message : String(error)
  });
});
