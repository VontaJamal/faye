# AGENTS.md

## Mission
Build and maintain Faye as a local-first, always-on voice agent skill that is free, secure, accessible, and production-minded.

## Quality Bar
- Keep the listener and dashboard always-on via user services.
- Preserve backward compatibility for core scripts where practical.
- Treat secrets as protected assets with least-privilege handling.
- Enforce the Seven Shadow gauntlet before release tags.

<!-- RINSHARI-UI:START -->
## Design Preflight Requirement (Managed)
For any UI/UX change, agents must do all of the following before implementation:
1. Read `design/rinshari-ui/templates/design-preflight.md`.
2. Audit repository animation/motion implementation first and note keep/change decisions.
3. Read relevant files in `design/rinshari-ui/principles/`.
4. Read local `docs/site-soul-brief.md`.
5. In task output/PR, provide:
   - Applied principles
   - Site Soul alignment
   - Animation audit summary
   - AI intent map
<!-- RINSHARI-UI:END -->

## Seven Shadow Doctrine (Upgrade Standard)
For each major upgrade, improve all seven domains:
1. Security
2. Accessibility
3. Testing
4. Execution
5. Scales
6. Value
7. Aesthetics

Every release candidate must pass `scripts/seven-shadow-test.sh` twice consecutively.
Architecture decisions should assume potential growth to 10 million users even while shipping local-first.
See `references/seven-shadow-doctrine.md` for the full doctrine contract.
