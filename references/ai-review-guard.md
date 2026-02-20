# AI Review Guard

AI Review Guard gives maintainers policy-based control over AI-influenced review content.

## Policy File

Path:
- `.faye/ai-review-guard.policy.json`

Core controls:
1. `blockBotAuthors`: block bot-origin review content by default.
2. `blockedAuthors` / `allowedAuthors`: explicit author controls.
3. `rules`: regex rules with `block` or `score` actions.
4. `maxAiScore`: threshold to fail on suspicious pattern score.
5. `disclosureTag` + `disclosureRequiredScore`: require explicit disclosure when AI-signal score is high.
6. `minHumanApprovals`: enforce minimum non-bot approvals via GitHub reviews API.

## Local Usage

```bash
npm run guard:ai-review -- \
  --event .faye/examples/pr_review_event.json \
  --event-name pull_request_review \
  --report .faye/reports/local-ai-review-guard-report.json
```

## CI Enforcement

Workflow:
- `.github/workflows/ai-review-guard.yml`

Triggers:
- `pull_request_review`
- `pull_request_review_comment`
- `issue_comment` (PR only)

Result behavior:
- `block` findings fail checks when enforcement is `block`.
- Reports are uploaded as workflow artifacts.

## Tuning Strategy

1. Start with strict bot blocking + explicit phrase blocks.
2. Add score-based phrases gradually to avoid false positives.
3. Keep `maxAiScore` conservative at first.
4. Require disclosure for high-score text.
5. Review report artifacts and adjust rules with real examples.

## Governance Notes

- The policy is repository-owned and versioned.
- Every change to policy should include rationale in PR description.
- Keep a small set of high-confidence block rules and a separate score-based set.
