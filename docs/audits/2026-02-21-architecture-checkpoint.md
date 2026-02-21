# Faye Architecture Checkpoint (2026-02-21)

## Scope
Checkpoint review focused on bug risk, architectural drift, performance pressure points, and bloat control while preserving backward compatibility for API/CLI contracts.

## Component Map
1. API control plane:
- `/Users/vonta/Documents/Code Repos/faye/app/src/api.ts`
- Exposes `/v1/*` local-only routes and static dashboard hosting.

2. Runtime orchestration:
- `/Users/vonta/Documents/Code Repos/faye/app/src/roundTripCoordinator.ts`
- `/Users/vonta/Documents/Code Repos/faye/app/src/conversationSessionManager.ts`
- `/Users/vonta/Documents/Code Repos/faye/app/src/metrics.ts`

3. Event bus:
- `/Users/vonta/Documents/Code Repos/faye/app/src/events.ts`
- Internal pub/sub fanout with recent-event ring buffer.

4. Listener and bridge runtime:
- `/Users/vonta/Documents/Code Repos/faye/scripts/listener.sh`
- `/Users/vonta/Documents/Code Repos/faye/app/src/telegramBridge.ts`

5. Dashboard frontend:
- `/Users/vonta/Documents/Code Repos/faye/dashboard/src/main.ts`
- `/Users/vonta/Documents/Code Repos/faye/dashboard/public/*`

6. Installer and operations:
- `/Users/vonta/Documents/Code Repos/faye/scripts/install*.sh`
- `/Users/vonta/Documents/Code Repos/faye/scripts/*-control.sh`

## Hotspot Map
1. High complexity files:
- `/Users/vonta/Documents/Code Repos/faye/app/src/api.ts` (~973 LOC)
- `/Users/vonta/Documents/Code Repos/faye/dashboard/src/main.ts` (~1534 LOC)
- `/Users/vonta/Documents/Code Repos/faye/scripts/listener.sh` (~700 LOC)

2. Runtime pressure points:
- Frequent listener polling during roundtrip wait loops.
- `/v1/health` route executes multiple service checks and doctor checks per call.

3. Contract concentration:
- API route contracts and recovery semantics concentrated in one backend file.
- Frontend action, render, and networking responsibilities concentrated in one file.

## Risk Register
1. `R1` performance coupling:
- Listener wait loop previously depended on heavyweight `/v1/health`.
- Mitigation: introduce lightweight `/v1/roundtrip/:sessionId/status`.

2. `R2` fanout fragility:
- A throwing event listener could interrupt downstream listeners.
- Mitigation: isolate listener failures in event bus fanout.

3. `R3` maintenance drift:
- Large monolith files increase change collision risk and review burden.
- Mitigation: staged decomposition into route/render/action modules.

4. `R4` artifact hygiene:
- Playwright output directories were not ignored.
- Mitigation: add `test-results/` and `playwright-report/` to `.gitignore`.

## Bloat Inventory
1. Tracked compiled dashboard artifact:
- `/Users/vonta/Documents/Code Repos/faye/dashboard/public/js/main.js`
- Decision: keep tracked this cycle; enforce source/artifact consistency via build + tests.

2. Script surface growth:
- `scripts/` includes installer, quality, burn-in, and recovery utilities.
- Decision: retain for operational value; tighten targeted tests over removing scripts.

3. Duplicate helper logic:
- Normalization and route helper patterns repeated across modules.
- Decision: extract shared helpers in backend decomposition stage.

## Assumption Matrix
| Assumption | Status | Validation Path | Next Action |
| --- | --- | --- | --- |
| `/v1/*` must remain loopback-only | Confirmed | Local-only middleware + tests | Keep invariant in route extraction |
| Existing CLI contracts are stable | Confirmed | `app/src/test/cli.test.ts` | No breaking flag/command changes |
| Bridge can be optional in onboarding | Confirmed | Health onboarding checks | Preserve optional behavior |
| Roundtrip progress can be queried independently | Confirmed | New status endpoint + tests | Use lightweight wait polling |
| Seven Shadow double-pass remains release gate | Confirmed | `scripts/seven-shadow-test.sh` | Keep gate unchanged |

## Checkpoint Outcome
System health is strong, but refactor and performance hardening are justified to prevent architectural drift. The checkpoint recommends staged decomposition with contract-preserving route and frontend module extraction.
