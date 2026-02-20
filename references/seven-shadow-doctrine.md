# Seven Shadow Doctrine (Faye Upgrade Standard)

Faye is built as a free product but engineered with 10 million-user readiness assumptions.

## Upgrade Rule

Any major capability change must improve all seven shadows, not just the feature itself.

1. Security
- Threat boundaries documented.
- Secret handling uses least privilege.

2. Accessibility
- Keyboard-first flows.
- Reduced-motion and semantic labels required.

3. Testing
- Critical path tests for setup, profile switching, and wake flow.
- Repeatable automated checks.

4. Execution
- Services auto-start and auto-recover.
- No terminal babysitting required for normal use.

5. Scales
- Local control plane API contracts stay stable.
- State and event model avoids lock-in to one transport.
- Architecture supports stepping from local single-user to distributed backends without rewriting contracts.

6. Value
- Faster onboarding and successful first wake session are tracked as primary outcomes.

7. Aesthetics
- Dashboard remains intentional and understandable while preserving usability.

## 10 Million Readiness Lens

Even while local-first, design every contract as if high-scale distribution is likely:
- Keep API boundaries explicit and versionable.
- Keep event payloads deterministic.
- Keep compatibility scripts stable.
- Keep migration paths documented.

## Release Gate

`./scripts/seven-shadow-test.sh` must pass two consecutive runs before release tags.
