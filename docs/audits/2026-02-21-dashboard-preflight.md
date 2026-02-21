# Dashboard Design Preflight - 2026-02-21

## Applied Principles
- `design/rinshari-ui/principles/000-foundations.md`
  - Kept changes principle-first: modularized implementation without forcing a new visual style.
  - Preserved explicit accessibility handling already present in dashboard markup/styles.
- `design/rinshari-ui/principles/001-seven-saints-system.md`
  - Prioritized execution and scale by decomposing `dashboard/src/main.ts` into focused modules.
  - Preserved aesthetics and reduced-motion behavior by keeping existing motion patterns and fallback CSS.
  - Avoided over-animation and avoided adding novelty UI behavior not tied to user outcome.

## Site Soul Alignment
- Source reviewed: `docs/site-soul-brief.md`.
- Current state: fields are placeholders with no defined local brand constraints.
- Alignment approach for this PR:
  - Preserve current dashboard visual language and copy.
  - Limit scope to architecture/runtime hardening and maintainability.
  - Avoid introducing new motifs until the Site Soul brief is populated.

## Animation Audit Summary
Files checked:
- `dashboard/public/styles.css`
  - Keep: `@keyframes rise` (entry motion) and `@keyframes panelPulse` (status pulse).
  - Keep: reduced-motion guard via `@media (prefers-reduced-motion: reduce)` disabling animations/transitions.
- `dashboard/src/main.ts` (pre-split baseline)
  - Keep behavior: runtime pulse trigger (`runtimeStatus.classList.add("pulse")` via `requestAnimationFrame`).
- `dashboard/src/render/health.ts`
  - Keep behavior post-split: same pulse trigger logic retained.

Keep/change decisions:
- Keep existing motion language and timing.
- Keep reduced-motion fallback unchanged.
- Change only architecture: moved behavior into modular files, no visual-motion expansion.

## Motion Intent Map
- Runtime panel pulse -> feedback that health metrics updated -> reduced motion: CSS media query disables pulse -> faster operator comprehension of fresh telemetry.
- Panel entry rise -> orient users during initial load -> reduced motion: animation removed under reduced-motion -> maintains clarity without motion burden.

## AI Intent Map
- Task: Dashboard modularization and runtime hardening.
- Value hypothesis: Smaller modules + guarded runtime loops reduce regression risk and operational drift while preserving UX.
- Data class: Local source code and non-sensitive repository docs only.
- Validation: TypeScript build, automated app/ops/dashboard tests, security/docs/accessibility gates.
- Fallback: Keep previous route/UI contracts and restore behavior through compatibility-preserving composition if any regression appears.
