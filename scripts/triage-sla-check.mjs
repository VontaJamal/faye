#!/usr/bin/env node
import fs from "node:fs";

const token = process.env.GITHUB_TOKEN ?? "";
const repo = process.env.GITHUB_REPOSITORY ?? "";
const apiBaseUrl = process.env.GITHUB_API_BASE_URL ?? "https://api.github.com";
const feedbackIssueNumber = Number(process.env.ALPHA_FEEDBACK_ISSUE_NUMBER ?? "1");
const testerIssueNumber = Number(process.env.TESTER_COHORT_ISSUE_NUMBER ?? "2");
const severitySlaHours = Number(process.env.TRIAGE_SEVERITY_SLA_HOURS ?? "24");
const outPath = process.env.TRIAGE_SLA_REPORT_PATH ?? "";

function fail(message, details = {}) {
  const payload = {
    ok: false,
    message,
    details
  };
  if (outPath) {
    fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
  console.error(`TRIAGE_SLA_FAIL: ${message}`);
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
  console.log("TRIAGE_SLA_PASS");
  console.log(JSON.stringify(payload, null, 2));
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

function hasSeverityLabel(labels = []) {
  return labels.some((label) => ["sev-1", "sev-2", "sev-3"].includes(label));
}

function labelNames(issue) {
  return Array.isArray(issue.labels)
    ? issue.labels
        .map((label) => (typeof label === "string" ? label : label?.name))
        .filter((value) => typeof value === "string")
    : [];
}

async function fetchAllOpenIssues(owner, name) {
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = `${apiBaseUrl}/repos/${owner}/${name}/issues?state=open&per_page=100&page=${page}`;
    const batch = await githubGet(url);
    if (!Array.isArray(batch)) {
      fail("Unexpected issue list response shape", { url });
    }
    all.push(...batch.filter((issue) => !issue.pull_request));
    if (batch.length < 100) {
      break;
    }
  }
  return all;
}

async function fetchRecentComments(owner, name, issueNumber, sinceIso) {
  const comments = [];
  for (let page = 1; page <= 5; page += 1) {
    const url = `${apiBaseUrl}/repos/${owner}/${name}/issues/${issueNumber}/comments?per_page=100&page=${page}`;
    const batch = await githubGet(url);
    if (!Array.isArray(batch)) {
      fail("Unexpected issue comments response shape", { url, issueNumber });
    }
    comments.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }

  return comments.filter((comment) => {
    const created = Date.parse(comment.created_at ?? "");
    return Number.isFinite(created) && created >= Date.parse(sinceIso);
  });
}

async function main() {
  if (!token) {
    fail("GITHUB_TOKEN is required");
  }
  if (!repo.includes("/")) {
    fail("GITHUB_REPOSITORY must be owner/repo", { repo });
  }

  const [owner, name] = repo.split("/");
  const now = Date.now();
  const sinceMs = now - severitySlaHours * 3_600_000;
  const sinceIso = new Date(sinceMs).toISOString();

  const [openIssues, feedbackComments, testerComments] = await Promise.all([
    fetchAllOpenIssues(owner, name),
    fetchRecentComments(owner, name, feedbackIssueNumber, sinceIso),
    fetchRecentComments(owner, name, testerIssueNumber, sinceIso)
  ]);

  const alphaBugIssues = openIssues.filter((issue) => {
    const labels = labelNames(issue);
    return labels.includes("bug") || labels.includes("alpha-feedback");
  });

  const missingSeverity = alphaBugIssues.filter((issue) => {
    const labels = labelNames(issue);
    const createdAtMs = Date.parse(issue.created_at ?? "");
    if (!Number.isFinite(createdAtMs)) {
      return false;
    }

    const ageHours = (now - createdAtMs) / 3_600_000;
    if (ageHours <= severitySlaHours) {
      return false;
    }

    return !hasSeverityLabel(labels);
  });

  const unresolvedSev1 = openIssues.filter((issue) => {
    const labels = labelNames(issue);
    return labels.includes("sev-1");
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    severitySlaHours,
    feedbackIssueNumber,
    testerIssueNumber,
    recentFeedbackComments: feedbackComments.length,
    recentTesterComments: testerComments.length,
    openAlphaBugIssues: alphaBugIssues.length,
    missingSeverityCount: missingSeverity.length,
    unresolvedSev1Count: unresolvedSev1.length,
    missingSeverity: missingSeverity.map((issue) => ({
      number: issue.number,
      title: issue.title,
      htmlUrl: issue.html_url,
      createdAt: issue.created_at
    })),
    unresolvedSev1: unresolvedSev1.map((issue) => ({
      number: issue.number,
      title: issue.title,
      htmlUrl: issue.html_url
    }))
  };

  if (missingSeverity.length > 0) {
    fail("Alpha bug issues exceeded severity labeling SLA", summary);
  }

  if (unresolvedSev1.length > 0) {
    fail("Unresolved sev-1 issues found; feature merges must pause", summary);
  }

  pass(summary);
}

main().catch((error) => {
  fail("Unhandled error in triage SLA check", {
    message: error instanceof Error ? error.message : String(error)
  });
});
