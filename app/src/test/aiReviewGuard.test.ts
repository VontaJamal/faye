import test from "node:test";
import assert from "node:assert/strict";

import { GuardPolicySchema, evaluateTargets, extractTargetsFromEvent } from "../aiReviewGuard";

const basePolicy = GuardPolicySchema.parse({
  version: 1,
  enforcement: "block",
  blockBotAuthors: true,
  blockedAuthors: [],
  allowedAuthors: [],
  scanPrBody: true,
  scanReviewBody: true,
  scanCommentBody: true,
  maxAiScore: 0.5,
  disclosureTag: "[AI-ASSISTED]",
  disclosureRequiredScore: 0.3,
  minHumanApprovals: 0,
  rules: [
    {
      name: "explicit",
      pattern: "as an ai language model",
      action: "block"
    },
    {
      name: "template",
      pattern: "great work",
      action: "score",
      weight: 0.35
    }
  ]
});

test("extractTargetsFromEvent includes review and PR body when configured", () => {
  const targets = extractTargetsFromEvent(
    "pull_request_review",
    {
      review: {
        id: 3,
        body: "Great work team.",
        user: { login: "someone", type: "User" }
      },
      pull_request: {
        number: 9,
        body: "PR body text",
        user: { login: "owner", type: "User" }
      }
    },
    basePolicy
  );

  assert.equal(targets.length, 2);
  assert.equal(targets[0]?.source, "pr_body");
  assert.equal(targets[1]?.source, "review");
});

test("evaluateTargets blocks bot authors by policy", () => {
  const result = evaluateTargets(basePolicy, [
    {
      source: "review",
      referenceId: "review:1",
      authorLogin: "some-bot[bot]",
      authorType: "Bot",
      body: "Looks good"
    }
  ]);

  const codes = result.findings.map((item) => item.code);
  assert.equal(codes.includes("GUARD_BOT_BLOCKED"), true);
});

test("evaluateTargets blocks explicit AI disclaimer phrase", () => {
  const result = evaluateTargets(basePolicy, [
    {
      source: "review",
      referenceId: "review:2",
      authorLogin: "human",
      authorType: "User",
      body: "As an AI language model, I suggest refactoring."
    }
  ]);

  const hasRuleBlock = result.findings.some((item) => item.code === "GUARD_RULE_BLOCK");
  assert.equal(hasRuleBlock, true);
});

test("evaluateTargets requires disclosure when score threshold reached", () => {
  const result = evaluateTargets(basePolicy, [
    {
      source: "review",
      referenceId: "review:3",
      authorLogin: "human",
      authorType: "User",
      body: "Great work."
    }
  ]);

  const hasDisclosureFinding = result.findings.some((item) => item.code === "GUARD_DISCLOSURE_REQUIRED");
  assert.equal(hasDisclosureFinding, true);
});

test("evaluateTargets accepts scored review with disclosure tag", () => {
  const result = evaluateTargets(basePolicy, [
    {
      source: "review",
      referenceId: "review:4",
      authorLogin: "human",
      authorType: "User",
      body: "Great work. [AI-ASSISTED]"
    }
  ]);

  const blocked = result.findings.filter((item) => item.severity === "block");
  assert.equal(blocked.length, 0);
});
