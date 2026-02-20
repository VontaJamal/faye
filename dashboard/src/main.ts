interface Profile {
  id: string;
  name: string;
  voiceId: string;
  voiceName: string;
  wakeWord: string;
}

interface ProfilesResponse {
  activeProfileId: string;
  profiles: Profile[];
}

interface BridgeRuntimeStatus {
  state: "starting" | "idle" | "processing" | "error";
  updatedAt: string;
  consecutiveErrors: number;
  backoffMs: number;
  lastErrorAt?: string;
  lastError?: string;
  lastSuccessAt?: string;
  lastOffset?: number;
  lastUpdateId?: number;
  lastCommandType?: string;
  lastCommandStatus?: "ok" | "error" | "duplicate";
}

interface RoundTripSnapshot {
  watchdogMs: number;
  autoRetryLimit: number;
  activeSessions: number;
  pendingSessions: Array<{
    sessionId: string;
    state: "wake_detected" | "awaiting_speak" | "speak_received";
    retryCount: number;
    ageMs: number;
    updatedAt: string;
  }>;
  totals: {
    started: number;
    retriesSent: number;
    completed: number;
    timeouts: number;
  };
  lastCompleted:
    | {
        sessionId: string;
        at: string;
        retryCount: number;
        status: "ok" | "error" | "duplicate";
      }
    | null;
  lastTimeout:
    | {
        sessionId: string;
        at: string;
        retryCount: number;
        reason: "watchdog" | "retry_send_failed" | "retry_unavailable";
      }
    | null;
}

interface MetricsSnapshot {
  generatedAt: string;
  eventCounts: {
    wakeDetections: number;
    messageTranscribed: number;
    listenerErrors: number;
    bridgeSpeakReceived: number;
  };
  roundTrip: {
    bridgeSpokenOk: number;
    bridgeSpokenError: number;
    bridgeSpokenDuplicate: number;
    retriesSent: number;
    timeouts: number;
    activeTrackedSessions: number;
  };
  latency: {
    samples: number;
    lastMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    maxMs: number | null;
  };
  errorRate: {
    numerator: number;
    denominator: number;
    value: number | null;
  };
}

interface HealthResponse {
  ok: boolean;
  doctor: unknown;
  services: unknown;
  bridgeRuntime: BridgeRuntimeStatus | null;
  roundTrip?: RoundTripSnapshot;
  metrics?: MetricsSnapshot;
}

const setupStatus = document.querySelector<HTMLParagraphElement>("#setup-status");
const profileList = document.querySelector<HTMLDivElement>("#profile-list");
const healthPre = document.querySelector<HTMLPreElement>("#health");
const eventsList = document.querySelector<HTMLUListElement>("#events");
const runtimeStatus = document.querySelector<HTMLDivElement>("#runtime-status");

function setStatus(message: string, error = false): void {
  if (!setupStatus) {
    return;
  }
  setupStatus.textContent = message;
  setupStatus.classList.toggle("error", error);
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    if (text) {
      try {
        const parsed = JSON.parse(text) as { error?: string; issues?: Array<{ path?: string; message?: string }> };
        if (parsed.error === "E_VALIDATION" && Array.isArray(parsed.issues) && parsed.issues.length > 0) {
          const message = parsed.issues
            .map((item) => `${item.path ?? "field"}: ${item.message ?? "invalid"}`)
            .join("; ");
          throw new Error(message);
        }
        if (parsed.error) {
          throw new Error(parsed.error);
        }
      } catch (error) {
        if (error instanceof Error && error.message.length > 0 && error.message !== text) {
          throw error;
        }
        throw new Error(text);
      }
    }
    throw new Error(`HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function optionalField(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : undefined;
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return date.toLocaleString();
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

function formatPercent(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function renderRuntimeStatus(runtime: BridgeRuntimeStatus | null, roundTrip?: RoundTripSnapshot, metrics?: MetricsSnapshot): void {
  if (!runtimeStatus) {
    return;
  }

  runtimeStatus.innerHTML = "";
  if (!runtime) {
    runtimeStatus.append(renderRuntimeCell("Bridge Runtime", "No runtime data yet."));
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

  if (!roundTrip) {
    return;
  }

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

  if (!metrics) {
    return;
  }

  runtimeStatus.append(
    renderRuntimeCell("Wake Detections", String(metrics.eventCounts.wakeDetections)),
    renderRuntimeCell("Spoken OK", String(metrics.roundTrip.bridgeSpokenOk)),
    renderRuntimeCell("p95 Latency", metrics.latency.p95Ms === null ? "n/a" : `${metrics.latency.p95Ms}ms`),
    renderRuntimeCell("Error Rate", formatPercent(metrics.errorRate.value))
  );
}

function appendProfileLine(container: HTMLElement, text: string, strong = false): void {
  const el = document.createElement(strong ? "strong" : "small");
  el.textContent = text;
  container.append(el, document.createElement("br"));
}

function profileCard(profile: Profile, activeProfileId: string): HTMLElement {
  const card = document.createElement("article");
  card.className = `profile-card ${profile.id === activeProfileId ? "active" : ""}`;
  appendProfileLine(card, profile.name, true);
  appendProfileLine(card, `ID: ${profile.id}`);
  appendProfileLine(card, `Voice: ${profile.voiceName} (${profile.voiceId})`);
  appendProfileLine(card, `Wake: ${profile.wakeWord}`);

  const actions = document.createElement("div");
  actions.className = "profile-actions";

  const wakeInput = document.createElement("input");
  wakeInput.type = "text";
  wakeInput.value = profile.wakeWord;
  wakeInput.setAttribute("aria-label", `Wake word for ${profile.name}`);

  const saveWake = document.createElement("button");
  saveWake.textContent = "Save Wake Word";
  saveWake.className = "secondary";
  saveWake.addEventListener("click", async () => {
    try {
      const wakeWord = wakeInput.value.trim();
      if (!wakeWord) {
        setStatus("Wake word cannot be empty.", true);
        return;
      }
      await api(`/v1/profiles/${profile.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          wakeWord,
          wakeWordVariants: [wakeWord.toLowerCase()]
        })
      });
      setStatus(`Wake word updated for ${profile.name}`);
      await refreshProfiles();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  const activate = document.createElement("button");
  activate.textContent = "Activate";
  activate.className = "secondary";
  activate.addEventListener("click", async () => {
    try {
      await api(`/v1/profiles/${profile.id}/activate`, { method: "POST" });
      setStatus(`Activated ${profile.name}`);
      await refreshProfiles();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  const remove = document.createElement("button");
  remove.textContent = "Delete";
  remove.className = "danger";
  remove.addEventListener("click", async () => {
    try {
      if (!confirm(`Delete profile ${profile.name}?`)) {
        return;
      }
      await api(`/v1/profiles/${profile.id}`, { method: "DELETE" });
      setStatus(`Deleted ${profile.name}`);
      await refreshProfiles();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  actions.append(wakeInput, saveWake, activate, remove);
  card.append(actions);
  return card;
}

async function refreshProfiles(): Promise<void> {
  if (!profileList) {
    return;
  }

  const data = await api<ProfilesResponse>("/v1/profiles");
  profileList.innerHTML = "";

  for (const profile of data.profiles) {
    profileList.append(profileCard(profile, data.activeProfileId));
  }
}

async function refreshHealth(): Promise<void> {
  if (!healthPre) {
    return;
  }

  const health = await api<HealthResponse>("/v1/health");
  healthPre.textContent = JSON.stringify(health, null, 2);
  renderRuntimeStatus(health.bridgeRuntime, health.roundTrip, health.metrics);
}

function bindSetupForm(): void {
  const form = document.querySelector<HTMLFormElement>("#setup-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const payload = {
      profileName: String(data.get("profileName") ?? "Primary Voice"),
      apiKey: optionalField(data.get("apiKey")),
      voiceId: String(data.get("voiceId") ?? ""),
      voiceName: String(data.get("voiceName") ?? ""),
      wakeWord: String(data.get("wakeWord") ?? "Faye Arise"),
      telegramToken: optionalField(data.get("telegramToken")),
      telegramChatId: optionalField(data.get("telegramChatId"))
    };

    try {
      await api("/v1/setup", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setStatus("Setup saved.");
      await refreshProfiles();
      await refreshHealth();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  const testButton = document.querySelector<HTMLButtonElement>("#test-voice");
  testButton?.addEventListener("click", async () => {
    try {
      await api("/v1/speak/test", {
        method: "POST",
        body: JSON.stringify({ text: "Faye is online." })
      });
      setStatus("Voice test played.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });
}

function bindCreateProfileForm(): void {
  const form = document.querySelector<HTMLFormElement>("#create-profile-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);

    try {
      await api("/v1/profiles", {
        method: "POST",
        body: JSON.stringify({
          name: String(data.get("name")),
          voiceId: String(data.get("voiceId")),
          voiceName: String(data.get("voiceName")),
          wakeWord: String(data.get("wakeWord")),
          wakeWordVariants: [String(data.get("wakeWord")).toLowerCase()],
          model: "eleven_multilingual_v2",
          stability: 0.4,
          similarityBoost: 0.8,
          style: 0.7,
          elevenLabsApiKeyPath: "~/.openclaw/secrets/elevenlabs-api-key.txt",
          silenceThreshold: "0.5%"
        })
      });
      setStatus("Profile created.");
      form.reset();
      await refreshProfiles();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });
}

function bindEvents(): void {
  if (!eventsList) {
    return;
  }

  const source = new EventSource("/v1/events");
  source.onmessage = (event) => {
    const li = document.createElement("li");
    li.textContent = event.data;
    eventsList.prepend(li);
    while (eventsList.children.length > 20) {
      eventsList.removeChild(eventsList.lastChild as Node);
    }
  };
}

async function bootstrap(): Promise<void> {
  bindSetupForm();
  bindCreateProfileForm();
  bindEvents();
  await refreshProfiles();
  await refreshHealth();
  setInterval(() => {
    void refreshHealth();
  }, 15000);
}

void bootstrap();
