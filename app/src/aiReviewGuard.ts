import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const GuardRuleSchema = z.object({
  name: z.string().min(1),
  pattern: z.string().min(1),
  action: z.enum(["block", "score"]),
  weight: z.number().min(0).max(1).default(0.25)
});

export const GuardPolicySchema = z.object({
  version: z.literal(1),
  enforcement: z.enum(["block", "warn"]).default("block"),
  blockBotAuthors: z.boolean().default(true),
  blockedAuthors: z.array(z.string().min(1)).default([]),
  allowedAuthors: z.array(z.string().min(1)).default([]),
  scanPrBody: z.boolean().default(true),
  scanReviewBody: z.boolean().default(true),
  scanCommentBody: z.boolean().default(true),
  maxAiScore: z.number().min(0).max(1).default(0.65),
  disclosureTag: z.string().min(1).default("[AI-ASSISTED]"),
  disclosureRequiredScore: z.number().min(0).max(1).default(0.45),
  minHumanApprovals: z.number().int().min(0).default(1),
  rules: z.array(GuardRuleSchema).min(1)
});

export type GuardPolicy = z.infer<typeof GuardPolicySchema>;

export interface ReviewTarget {
  source: "pr_body" | "review" | "comment";
  referenceId: string;
  authorLogin: string;
  authorType: "User" | "Bot" | "Unknown";
  body: string;
}

export interface GuardFinding {
  code: string;
  severity: "block" | "warn";
  message: string;
  targetReferenceId?: string;
  details?: Record<string, unknown>;
}

export interface TargetEvaluation {
  target: ReviewTarget;
  aiScore: number;
  matchedRules: string[];
  findings: GuardFinding[];
}

export interface GuardResult {
  targetEvaluations: TargetEvaluation[];
  findings: GuardFinding[];
  highestScore: number;
}

interface PullContext {
  owner: string;
  repo: string;
  pullNumber: number;
}

interface GitHubReview {
  state?: string;
  user?: {
    login?: string;
    type?: string;
  };
}

interface ParsedArgs {
  policyPath: string;
  eventPath?: string;
  eventName?: string;
  reportPath?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    policyPath: ".faye/ai-review-guard.policy.json"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (token === "--policy") {
      args.policyPath = argv[i + 1] ?? args.policyPath;
      i += 1;
      continue;
    }

    if (token === "--event") {
      args.eventPath = argv[i + 1] ?? args.eventPath;
      i += 1;
      continue;
    }

    if (token === "--event-name") {
      args.eventName = argv[i + 1] ?? args.eventName;
      i += 1;
      continue;
    }

    if (token === "--report") {
      args.reportPath = argv[i + 1] ?? args.reportPath;
      i += 1;
      continue;
    }
  }

  return args;
}

function normalizeLogin(value: string): string {
  return value.trim().toLowerCase();
}

function toLowerSet(values: string[]): Set<string> {
  return new Set(values.map((value) => normalizeLogin(value)));
}

function getActorInfo(user: unknown): { login: string; type: "User" | "Bot" | "Unknown" } {
  if (!user || typeof user !== "object") {
    return { login: "unknown", type: "Unknown" };
  }

  const login = typeof (user as { login?: unknown }).login === "string"
    ? (user as { login: string }).login
    : "unknown";

  const rawType = typeof (user as { type?: unknown }).type === "string"
    ? (user as { type: string }).type
    : "Unknown";

  if (rawType === "Bot") {
    return { login, type: "Bot" };
  }
  if (rawType === "User") {
    return { login, type: "User" };
  }

  if (login.endsWith("[bot]")) {
    return { login, type: "Bot" };
  }

  return { login, type: "Unknown" };
}

export function extractTargetsFromEvent(eventName: string, payload: unknown, policy: GuardPolicy): ReviewTarget[] {
  const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const targets: ReviewTarget[] = [];

  const pullRequest = obj.pull_request && typeof obj.pull_request === "object"
    ? (obj.pull_request as Record<string, unknown>)
    : null;

  if (policy.scanPrBody && pullRequest && typeof pullRequest.body === "string" && pullRequest.body.trim().length > 0) {
    const actor = getActorInfo(pullRequest.user);
    targets.push({
      source: "pr_body",
      referenceId: `pr:${String(pullRequest.number ?? "unknown")}`,
      authorLogin: actor.login,
      authorType: actor.type,
      body: pullRequest.body
    });
  }

  const review = obj.review && typeof obj.review === "object" ? (obj.review as Record<string, unknown>) : null;
  if (policy.scanReviewBody && review && typeof review.body === "string" && review.body.trim().length > 0) {
    const actor = getActorInfo(review.user);
    targets.push({
      source: "review",
      referenceId: `review:${String(review.id ?? "unknown")}`,
      authorLogin: actor.login,
      authorType: actor.type,
      body: review.body
    });
  }

  const comment = obj.comment && typeof obj.comment === "object" ? (obj.comment as Record<string, unknown>) : null;
  if (policy.scanCommentBody && comment && typeof comment.body === "string" && comment.body.trim().length > 0) {
    const actor = getActorInfo(comment.user);
    targets.push({
      source: "comment",
      referenceId: `comment:${String(comment.id ?? "unknown")}`,
      authorLogin: actor.login,
      authorType: actor.type,
      body: comment.body
    });
  }

  if (targets.length === 0 && eventName === "pull_request" && pullRequest && typeof pullRequest.body === "string") {
    const actor = getActorInfo(pullRequest.user);
    targets.push({
      source: "pr_body",
      referenceId: `pr:${String(pullRequest.number ?? "unknown")}`,
      authorLogin: actor.login,
      authorType: actor.type,
      body: pullRequest.body
    });
  }

  return targets;
}

function buildRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, "i");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`E_INVALID_RULE_REGEX: pattern='${pattern}' error='${message}'`);
  }
}

export function evaluateTargets(policy: GuardPolicy, targets: ReviewTarget[]): GuardResult {
  const blockedAuthors = toLowerSet(policy.blockedAuthors);
  const allowedAuthors = toLowerSet(policy.allowedAuthors);

  const targetEvaluations: TargetEvaluation[] = [];
  const globalFindings: GuardFinding[] = [];
  let highestScore = 0;

  const compiledRules = policy.rules.map((rule) => ({
    ...rule,
    regex: buildRegex(rule.pattern)
  }));

  for (const target of targets) {
    const findings: GuardFinding[] = [];
    const matchedRules: string[] = [];
    const author = normalizeLogin(target.authorLogin);

    if (allowedAuthors.has(author)) {
      const evalResult: TargetEvaluation = {
        target,
        aiScore: 0,
        matchedRules,
        findings
      };
      targetEvaluations.push(evalResult);
      continue;
    }

    if (blockedAuthors.has(author)) {
      findings.push({
        code: "GUARD_BLOCKED_AUTHOR",
        severity: "block",
        message: `Review author '${target.authorLogin}' is blocked by policy`,
        targetReferenceId: target.referenceId
      });
    }

    if (policy.blockBotAuthors && target.authorType === "Bot") {
      findings.push({
        code: "GUARD_BOT_BLOCKED",
        severity: "block",
        message: `Bot-origin review content blocked for '${target.authorLogin}'`,
        targetReferenceId: target.referenceId
      });
    }

    let aiScore = 0;
    for (const rule of compiledRules) {
      if (!rule.regex.test(target.body)) {
        continue;
      }

      matchedRules.push(rule.name);
      if (rule.action === "block") {
        findings.push({
          code: "GUARD_RULE_BLOCK",
          severity: "block",
          message: `Blocked by rule '${rule.name}'`,
          targetReferenceId: target.referenceId,
          details: {
            rule: rule.name
          }
        });
      } else {
        aiScore += rule.weight;
      }
    }

    aiScore = Math.min(1, aiScore);
    highestScore = Math.max(highestScore, aiScore);

    if (
      aiScore >= policy.disclosureRequiredScore &&
      !target.body.toLowerCase().includes(policy.disclosureTag.toLowerCase())
    ) {
      findings.push({
        code: "GUARD_DISCLOSURE_REQUIRED",
        severity: "block",
        message: `Missing disclosure tag '${policy.disclosureTag}' for high AI-score review`,
        targetReferenceId: target.referenceId,
        details: {
          aiScore,
          threshold: policy.disclosureRequiredScore
        }
      });
    }

    if (aiScore > policy.maxAiScore) {
      findings.push({
        code: "GUARD_AI_SCORE_EXCEEDED",
        severity: "block",
        message: `AI signal score ${aiScore.toFixed(3)} exceeds max ${policy.maxAiScore.toFixed(3)}`,
        targetReferenceId: target.referenceId,
        details: {
          aiScore,
          maxAiScore: policy.maxAiScore
        }
      });
    }

    const evalResult: TargetEvaluation = {
      target,
      aiScore,
      matchedRules,
      findings
    };

    targetEvaluations.push(evalResult);
    globalFindings.push(...findings);
  }

  return {
    targetEvaluations,
    findings: globalFindings,
    highestScore
  };
}

function parseRepoFullName(payload: Record<string, unknown>): { owner: string; repo: string } | null {
  const repoObj = payload.repository && typeof payload.repository === "object"
    ? (payload.repository as Record<string, unknown>)
    : null;

  if (!repoObj || typeof repoObj.full_name !== "string") {
    return null;
  }

  const [owner, repo] = repoObj.full_name.split("/");
  if (!owner || !repo) {
    return null;
  }

  return { owner, repo };
}

function extractPullContext(eventName: string, payload: unknown): PullContext | null {
  const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  if (!obj) {
    return null;
  }

  const repo = parseRepoFullName(obj);
  if (!repo) {
    return null;
  }

  const pullRequest = obj.pull_request && typeof obj.pull_request === "object"
    ? (obj.pull_request as Record<string, unknown>)
    : null;

  if (pullRequest && typeof pullRequest.number === "number") {
    return {
      owner: repo.owner,
      repo: repo.repo,
      pullNumber: pullRequest.number
    };
  }

  if (eventName === "issue_comment") {
    const issue = obj.issue && typeof obj.issue === "object" ? (obj.issue as Record<string, unknown>) : null;
    const isPrComment = issue && issue.pull_request && typeof issue.pull_request === "object";
    if (issue && isPrComment && typeof issue.number === "number") {
      return {
        owner: repo.owner,
        repo: repo.repo,
        pullNumber: issue.number
      };
    }
  }

  return null;
}

async function fetchHumanApprovalCount(
  context: PullContext,
  githubToken: string,
  allowedAuthors: Set<string>
): Promise<number> {
  const latestStateByLogin = new Map<string, { state: string; type: string }>();

  let page = 1;
  while (true) {
    const url = `https://api.github.com/repos/${context.owner}/${context.repo}/pulls/${context.pullNumber}/reviews?per_page=100&page=${page}`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`E_GITHUB_REVIEWS_HTTP_${response.status}: ${text.slice(0, 180)}`);
    }

    const reviews = (await response.json()) as GitHubReview[];
    if (!Array.isArray(reviews) || reviews.length === 0) {
      break;
    }

    for (const review of reviews) {
      const login = typeof review.user?.login === "string" ? normalizeLogin(review.user.login) : "";
      if (!login) {
        continue;
      }

      latestStateByLogin.set(login, {
        state: String(review.state ?? ""),
        type: String(review.user?.type ?? "Unknown")
      });
    }

    if (reviews.length < 100) {
      break;
    }

    page += 1;
  }

  let approvals = 0;
  for (const [login, latest] of latestStateByLogin.entries()) {
    if (allowedAuthors.has(login)) {
      continue;
    }
    if (latest.type === "Bot") {
      continue;
    }
    if (latest.state === "APPROVED") {
      approvals += 1;
    }
  }

  return approvals;
}

function decideOutcome(policy: GuardPolicy, findings: GuardFinding[]): "pass" | "warn" | "block" {
  const hasBlock = findings.some((item) => item.severity === "block");
  if (hasBlock && policy.enforcement === "block") {
    return "block";
  }
  if (findings.length > 0) {
    return "warn";
  }
  return "pass";
}

async function loadJsonFile(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

async function writeReport(reportPath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function run(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const eventPath = args.eventPath ?? process.env.GITHUB_EVENT_PATH;
  const eventName = args.eventName ?? process.env.GITHUB_EVENT_NAME ?? "unknown";

  if (!eventPath) {
    throw new Error("E_EVENT_PATH_REQUIRED");
  }

  const policyRaw = await loadJsonFile(args.policyPath);
  const eventPayload = await loadJsonFile(eventPath);

  const policy = GuardPolicySchema.parse(policyRaw);
  const targets = extractTargetsFromEvent(eventName, eventPayload, policy);

  const baseResult = evaluateTargets(policy, targets);
  const findings: GuardFinding[] = [...baseResult.findings];

  const allowedAuthors = toLowerSet(policy.allowedAuthors);

  const pullContext = extractPullContext(eventName, eventPayload);
  let humanApprovals: { required: number; actual: number | null; checked: boolean } = {
    required: policy.minHumanApprovals,
    actual: null,
    checked: false
  };

  if (policy.minHumanApprovals > 0 && pullContext) {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      findings.push({
        code: "GUARD_APPROVALS_SKIPPED",
        severity: "warn",
        message: "GITHUB_TOKEN unavailable; unable to verify human approvals"
      });
    } else {
      const approvals = await fetchHumanApprovalCount(pullContext, githubToken, allowedAuthors);
      humanApprovals = {
        required: policy.minHumanApprovals,
        actual: approvals,
        checked: true
      };

      if (approvals < policy.minHumanApprovals) {
        findings.push({
          code: "GUARD_HUMAN_APPROVALS",
          severity: "block",
          message: `Human approvals ${approvals} below required ${policy.minHumanApprovals}`,
          details: {
            approvals,
            required: policy.minHumanApprovals
          }
        });
      }
    }
  }

  const decision = decideOutcome(policy, findings);

  const summary = {
    timestamp: new Date().toISOString(),
    eventName,
    policyPath: args.policyPath,
    enforcement: policy.enforcement,
    targetsScanned: targets.length,
    highestAiScore: baseResult.highestScore,
    humanApprovals,
    findings,
    decision,
    targets: baseResult.targetEvaluations
  };

  if (args.reportPath) {
    await writeReport(args.reportPath, summary);
  }

  console.log(JSON.stringify(summary, null, 2));

  return decision === "block" ? 1 : 0;
}

if (require.main === module) {
  run()
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`AI review guard failed: ${message}`);
      process.exit(1);
    });
}
