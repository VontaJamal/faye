#!/usr/bin/env node
import fs from "node:fs";

const token = process.env.GITHUB_TOKEN ?? "";
const repo = process.env.GITHUB_REPOSITORY ?? "";
const apiBaseUrl = process.env.GITHUB_API_BASE_URL ?? "https://api.github.com";
const issueNumber = Number(process.env.BURN_IN_ISSUE_NUMBER ?? "3");
const summaryPath = process.env.BURN_IN_SUMMARY_PATH ?? "";
const dayOneDate = process.env.BURN_IN_DAY1_DATE ?? "2026-02-20";
const checklistStart = Number(process.env.BURN_IN_CHECKLIST_START_DAY ?? "2");
const checklistEnd = Number(process.env.BURN_IN_CHECKLIST_END_DAY ?? "7");

function fail(message, details = {}) {
  console.error(`BURN_IN_ISSUE_UPDATE_FAIL: ${message}`);
  if (Object.keys(details).length > 0) {
    console.error(JSON.stringify(details, null, 2));
  }
  process.exit(1);
}

function log(message, details = {}) {
  const payload = {
    message,
    ...details
  };
  console.log(JSON.stringify(payload));
}

async function githubRequest(url, method = "GET", body = undefined) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  if (!response.ok) {
    const text = await response.text();
    fail("GitHub API request failed", {
      url,
      method,
      status: response.status,
      body: text
    });
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function parseSummary(path) {
  if (!path) {
    fail("BURN_IN_SUMMARY_PATH is required");
  }
  if (!fs.existsSync(path)) {
    fail("Summary file not found", { path });
  }

  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    fail("Unable to parse burn-in summary JSON", {
      path,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function dayIndex(dateValue, dayOneValue) {
  const dateMs = Date.parse(`${dateValue}T00:00:00Z`);
  const dayOneMs = Date.parse(`${dayOneValue}T00:00:00Z`);
  if (!Number.isFinite(dateMs) || !Number.isFinite(dayOneMs)) {
    return null;
  }
  return Math.floor((dateMs - dayOneMs) / 86_400_000) + 1;
}

function statusEmoji(pass) {
  return pass ? "PASS" : "FAIL";
}

function buildComment(summary) {
  const marker = summary.pass
    ? `Burn-in day passed: ${summary.date}`
    : `Burn-in day failed: ${summary.date}`;

  const check = (key) => {
    const value = summary?.checks?.[key]?.result;
    return value === "pass" ? "pass" : "fail";
  };

  const lines = [
    `## Burn-In Daily Status (${summary.date})`,
    "",
    `${marker}`,
    "",
    `- Overall: ${statusEmoji(Boolean(summary.pass))}`,
    `- Canary: ${check("canary")}`,
    `- Seven-shadow double pass: ${check("sevenShadowDoublePass")}`,
    `- Audit (high): ${check("auditHigh")}`,
    `- SLO eval: ${check("sloEval")}`,
    `- Report artifact/path: \`${summary?.artifacts?.reportPath ?? "n/a"}\``,
    ""
  ];

  return lines.join("\n");
}

function updateChecklistBody(currentBody, day, date, pass) {
  if (!Number.isInteger(day) || day < checklistStart || day > checklistEnd) {
    return {
      body: currentBody,
      updated: false
    };
  }

  const normalized = typeof currentBody === "string" ? currentBody : "";
  const statusLabel = pass ? "pass" : "fail";
  const replacement = `- [${pass ? "x" : " "}] Day ${day} (${date}) - ${statusLabel}`;
  const lineRegex = new RegExp(`^- \\[(?: |x|X)\\] Day\\s*${day}\\b.*$`, "m");

  if (lineRegex.test(normalized)) {
    return {
      body: normalized.replace(lineRegex, replacement),
      updated: true
    };
  }

  if (normalized.includes("## Burn-In Checklist")) {
    return {
      body: `${normalized.trimEnd()}\n${replacement}\n`,
      updated: true
    };
  }

  const section = `\n\n## Burn-In Checklist\n${replacement}\n`;
  return {
    body: `${normalized.trimEnd()}${section}`,
    updated: true
  };
}

async function main() {
  if (!token) {
    fail("GITHUB_TOKEN is required");
  }

  if (!repo.includes("/")) {
    fail("GITHUB_REPOSITORY must be owner/repo", { repo });
  }

  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    fail("BURN_IN_ISSUE_NUMBER must be a positive integer", { issueNumber });
  }

  const summary = parseSummary(summaryPath);
  const date = typeof summary?.date === "string" ? summary.date : null;
  if (!date) {
    fail("Burn-in summary must include date", { summaryPath });
  }

  const [owner, name] = repo.split("/");
  const issueUrl = `${apiBaseUrl}/repos/${owner}/${name}/issues/${issueNumber}`;

  const issue = await githubRequest(issueUrl);
  const commentBody = buildComment(summary);

  await githubRequest(`${issueUrl}/comments`, "POST", {
    body: commentBody
  });

  const day = dayIndex(date, dayOneDate);
  const checklistUpdate = updateChecklistBody(issue?.body ?? "", day, date, Boolean(summary.pass));
  if (checklistUpdate.updated && checklistUpdate.body !== issue?.body) {
    await githubRequest(issueUrl, "PATCH", {
      body: checklistUpdate.body
    });
  }

  log("Burn-in issue updated", {
    issueNumber,
    date,
    day,
    pass: Boolean(summary.pass),
    checklistUpdated: checklistUpdate.updated
  });
}

main().catch((error) => {
  fail("Unhandled error while updating burn-in issue", {
    message: error instanceof Error ? error.message : String(error)
  });
});
