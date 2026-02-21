import type {
  BridgeRuntimeStatus,
  DashboardState,
  HealthResponse,
  MetricsSnapshot,
  OnboardingChecklistItem,
  RoundTripSnapshot,
  ServiceStatusResult
} from "../state/store.js";

function formatTimestamp(value?: string | null): string {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return date.toLocaleString();
}

function formatDuration(valueMs: number | null): string {
  if (valueMs === null) {
    return "n/a";
  }
  const minutes = valueMs / 60_000;
  return `${minutes.toFixed(1)} min`;
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function appendEmptyState(container: HTMLElement, text: string): void {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.textContent = text;
  container.append(div);
}

function makeChip(label: string, value: string, state: "good" | "warn" | "bad" = "warn"): HTMLElement {
  const chip = document.createElement("span");
  chip.className = `status-chip ${state}`;
  chip.textContent = `${label}: ${value}`;
  return chip;
}

function classifyService(result?: ServiceStatusResult): "good" | "bad" {
  return result?.code === 0 ? "good" : "bad";
}

function classifyErrorRate(value: number | null): "good" | "warn" | "bad" {
  if (value === null) {
    return "warn";
  }
  if (value <= 0.02) {
    return "good";
  }
  if (value <= 0.06) {
    return "warn";
  }
  return "bad";
}

function classifyLatency(value: number | null): "good" | "warn" | "bad" {
  if (value === null) {
    return "warn";
  }
  if (value <= 2500) {
    return "good";
  }
  if (value <= 5000) {
    return "warn";
  }
  return "bad";
}

function itemFromOnboarding(health: HealthResponse | null, itemId: string): OnboardingChecklistItem | null {
  const items = health?.onboarding?.checklist.items ?? [];
  return items.find((item) => item.id === itemId) ?? null;
}

function renderServiceSummary(state: DashboardState, health: HealthResponse): void {
  const serviceSummary = state.elements.serviceSummary;
  if (!serviceSummary) {
    return;
  }

  serviceSummary.innerHTML = "";
  const listener = health.services?.listener;
  const dashboard = health.services?.dashboard;
  const bridge = health.services?.bridge;
  const checklist = health.onboarding?.checklist;

  serviceSummary.append(
    makeChip("Doctor", health.doctor?.ok === true ? "ok" : "attention", health.doctor?.ok === true ? "good" : "bad"),
    makeChip("Listener", listener?.code === 0 ? "running" : "down", classifyService(listener)),
    makeChip("Dashboard", dashboard?.code === 0 ? "running" : "down", classifyService(dashboard)),
    makeChip("Bridge", bridge?.code === 0 ? "running" : "down", classifyService(bridge)),
    makeChip(
      "p95",
      health.metrics?.latency.p95Ms === null || health.metrics?.latency.p95Ms === undefined
        ? "n/a"
        : `${health.metrics.latency.p95Ms}ms`,
      classifyLatency(health.metrics?.latency.p95Ms ?? null)
    ),
    makeChip(
      "Error Rate",
      formatPercent(health.metrics?.errorRate.value ?? null),
      classifyErrorRate(health.metrics?.errorRate.value ?? null)
    )
  );

  if (checklist) {
    serviceSummary.append(
      makeChip(
        "First Success",
        `${checklist.completed}/${checklist.total}`,
        checklist.completed === checklist.total ? "good" : "warn"
      )
    );
  }
}

function renderRuntimeCell(label: string, value: string): HTMLElement {
  const item = document.createElement("div");
  item.className = "runtime-item";

  const title = document.createElement("strong");
  title.textContent = label;

  const content = document.createElement("span");
  content.textContent = value;

  item.append(title, content);
  return item;
}

function renderRuntimeStatus(
  state: DashboardState,
  runtime: BridgeRuntimeStatus | null,
  roundTrip?: RoundTripSnapshot,
  metrics?: MetricsSnapshot
): void {
  const runtimeStatus = state.elements.runtimeStatus;
  if (!runtimeStatus) {
    return;
  }

  runtimeStatus.classList.remove("pulse");
  runtimeStatus.innerHTML = "";

  if (!runtime) {
    appendEmptyState(runtimeStatus, "No bridge runtime data yet.");
    return;
  }

  runtimeStatus.append(
    renderRuntimeCell("Bridge State", runtime.state),
    renderRuntimeCell("Consecutive Errors", String(runtime.consecutiveErrors)),
    renderRuntimeCell("Backoff", `${runtime.backoffMs}ms`),
    renderRuntimeCell("Last Update", typeof runtime.lastUpdateId === "number" ? String(runtime.lastUpdateId) : "n/a"),
    renderRuntimeCell("Last Offset", typeof runtime.lastOffset === "number" ? String(runtime.lastOffset) : "n/a"),
    renderRuntimeCell(
      "Last Command",
      runtime.lastCommandType ? `${runtime.lastCommandType} (${runtime.lastCommandStatus ?? "unknown"})` : "n/a"
    ),
    renderRuntimeCell("Last Success", formatTimestamp(runtime.lastSuccessAt)),
    renderRuntimeCell(
      "Last Error",
      runtime.lastError ? `${formatTimestamp(runtime.lastErrorAt)} | ${runtime.lastError}` : "n/a"
    )
  );

  if (roundTrip) {
    const lastCompleted = roundTrip.lastCompleted
      ? `${roundTrip.lastCompleted.status} @ ${formatTimestamp(roundTrip.lastCompleted.at)}`
      : "n/a";
    const lastTimeout = roundTrip.lastTimeout
      ? `${roundTrip.lastTimeout.reason} @ ${formatTimestamp(roundTrip.lastTimeout.at)}`
      : "n/a";

    runtimeStatus.append(
      renderRuntimeCell("Round-Trip Active", String(roundTrip.activeSessions)),
      renderRuntimeCell("Round-Trip Retries", String(roundTrip.totals.retriesSent)),
      renderRuntimeCell("Round-Trip Timeouts", String(roundTrip.totals.timeouts)),
      renderRuntimeCell("Round-Trip Completed", String(roundTrip.totals.completed)),
      renderRuntimeCell("Round-Trip Last Completed", lastCompleted),
      renderRuntimeCell("Round-Trip Last Timeout", lastTimeout)
    );
  }

  if (metrics) {
    runtimeStatus.append(
      renderRuntimeCell("Wake Detections", String(metrics.eventCounts.wakeDetections)),
      renderRuntimeCell("Spoken OK", String(metrics.roundTrip.bridgeSpokenOk)),
      renderRuntimeCell("p95 Latency", metrics.latency.p95Ms === null ? "n/a" : `${metrics.latency.p95Ms}ms`),
      renderRuntimeCell("Error Rate", formatPercent(metrics.errorRate.value))
    );
  }

  requestAnimationFrame(() => runtimeStatus.classList.add("pulse"));
}

function renderFirstSuccessChecklist(state: DashboardState, health: HealthResponse): void {
  const firstSuccessChecklist = state.elements.firstSuccessChecklist;
  if (!firstSuccessChecklist) {
    return;
  }

  firstSuccessChecklist.innerHTML = "";
  const onboarding = health.onboarding;
  if (!onboarding) {
    appendEmptyState(firstSuccessChecklist, "Checklist data not available yet.");
    return;
  }

  const progress = document.createElement("p");
  progress.className = "checklist-progress";
  progress.textContent = `Progress: ${onboarding.checklist.completed}/${onboarding.checklist.total}`;

  const goal = document.createElement("p");
  goal.className = "checklist-goal";
  goal.textContent =
    onboarding.checklist.completed === onboarding.checklist.total
      ? "Ready. You can now talk to your agent in a stable loop."
      : "Talk to your agent in under 10 minutes by completing every item below.";

  const list = document.createElement("ul");
  list.className = "checklist-items";

  for (const item of onboarding.checklist.items) {
    const li = document.createElement("li");
    li.className = `checklist-item ${item.ok ? "good" : "bad"}`;

    const title = document.createElement("span");
    title.className = "checklist-label";
    title.textContent = item.label;

    const message = document.createElement("small");
    message.className = "checklist-message";
    message.textContent = item.message;

    li.append(title, message);
    list.append(li);
  }

  const metrics = document.createElement("div");
  metrics.className = "checklist-metrics";
  metrics.innerHTML = [
    `First setup: ${formatTimestamp(onboarding.firstSetupAt)}`,
    `First voice success: ${formatTimestamp(onboarding.firstVoiceSuccessAt)}`,
    `Time to first success: ${formatDuration(onboarding.timeToFirstSuccessMs)}`,
    `Last voice test: ${formatTimestamp(onboarding.lastVoiceTestAt)}`
  ]
    .map((entry) => `<p>${entry}</p>`)
    .join("");

  firstSuccessChecklist.append(progress, goal, list, metrics);
}

export function apiKeyReadyForActiveProfile(state: DashboardState): boolean {
  return itemFromOnboarding(state.latestHealth, "api-key-ready")?.ok === true;
}

export function renderHealthPanels(state: DashboardState, health: HealthResponse): void {
  renderRuntimeStatus(state, health.bridgeRuntime, health.roundTrip, health.metrics);
  renderServiceSummary(state, health);
  renderFirstSuccessChecklist(state, health);
}
