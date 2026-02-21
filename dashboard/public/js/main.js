"use strict";
const setupStatus = document.querySelector("#setup-status");
const profileList = document.querySelector("#profile-list");
const healthPre = document.querySelector("#health");
const eventsList = document.querySelector("#events");
const runtimeStatus = document.querySelector("#runtime-status");
const serviceSummary = document.querySelector("#service-summary");
function setStatus(message, error = false) {
    if (!setupStatus) {
        return;
    }
    setupStatus.textContent = message;
    setupStatus.classList.toggle("error", error);
}
async function api(url, init) {
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
                const parsed = JSON.parse(text);
                if (parsed.error === "E_VALIDATION" && Array.isArray(parsed.issues) && parsed.issues.length > 0) {
                    const message = parsed.issues
                        .map((item) => `${item.path ?? "field"}: ${item.message ?? "invalid"}`)
                        .join("; ");
                    throw new Error(message);
                }
                if (parsed.error) {
                    throw new Error(parsed.error);
                }
            }
            catch (error) {
                if (error instanceof Error && error.message.length > 0 && error.message !== text) {
                    throw error;
                }
                throw new Error(text);
            }
        }
        throw new Error(`HTTP ${response.status}`);
    }
    if (response.status === 204) {
        return undefined;
    }
    return (await response.json());
}
function optionalField(value) {
    const text = String(value ?? "").trim();
    return text.length > 0 ? text : undefined;
}
function formatTimestamp(value) {
    if (!value) {
        return "n/a";
    }
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) {
        return value;
    }
    return date.toLocaleString();
}
function formatPercent(value) {
    if (value === null) {
        return "n/a";
    }
    return `${(value * 100).toFixed(1)}%`;
}
function appendEmptyState(container, text) {
    const div = document.createElement("div");
    div.className = "empty-state";
    div.textContent = text;
    container.append(div);
}
function makeChip(label, value, state = "warn") {
    const chip = document.createElement("span");
    chip.className = `status-chip ${state}`;
    chip.textContent = `${label}: ${value}`;
    return chip;
}
function classifyService(result) {
    return result?.code === 0 ? "good" : "bad";
}
function classifyErrorRate(value) {
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
function classifyLatency(value) {
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
function renderServiceSummary(health) {
    if (!serviceSummary) {
        return;
    }
    serviceSummary.innerHTML = "";
    const listener = health.services?.listener;
    const dashboard = health.services?.dashboard;
    const bridge = health.services?.bridge;
    serviceSummary.append(makeChip("Doctor", health.doctor?.ok === true ? "ok" : "attention", health.doctor?.ok === true ? "good" : "bad"), makeChip("Listener", listener?.code === 0 ? "running" : "down", classifyService(listener)), makeChip("Dashboard", dashboard?.code === 0 ? "running" : "down", classifyService(dashboard)), makeChip("Bridge", bridge?.code === 0 ? "running" : "down", classifyService(bridge)), makeChip("p95", health.metrics?.latency.p95Ms === null || health.metrics?.latency.p95Ms === undefined
        ? "n/a"
        : `${health.metrics.latency.p95Ms}ms`, classifyLatency(health.metrics?.latency.p95Ms ?? null)), makeChip("Error Rate", formatPercent(health.metrics?.errorRate.value ?? null), classifyErrorRate(health.metrics?.errorRate.value ?? null)));
}
function renderRuntimeCell(label, value) {
    const item = document.createElement("div");
    item.className = "runtime-item";
    const title = document.createElement("strong");
    title.textContent = label;
    const content = document.createElement("span");
    content.textContent = value;
    item.append(title, content);
    return item;
}
function renderRuntimeStatus(runtime, roundTrip, metrics) {
    if (!runtimeStatus) {
        return;
    }
    runtimeStatus.classList.remove("pulse");
    runtimeStatus.innerHTML = "";
    if (!runtime) {
        appendEmptyState(runtimeStatus, "No bridge runtime data yet.");
        return;
    }
    runtimeStatus.append(renderRuntimeCell("Bridge State", runtime.state), renderRuntimeCell("Consecutive Errors", String(runtime.consecutiveErrors)), renderRuntimeCell("Backoff", `${runtime.backoffMs}ms`), renderRuntimeCell("Last Update", typeof runtime.lastUpdateId === "number" ? String(runtime.lastUpdateId) : "n/a"), renderRuntimeCell("Last Offset", typeof runtime.lastOffset === "number" ? String(runtime.lastOffset) : "n/a"), renderRuntimeCell("Last Command", runtime.lastCommandType ? `${runtime.lastCommandType} (${runtime.lastCommandStatus ?? "unknown"})` : "n/a"), renderRuntimeCell("Last Success", formatTimestamp(runtime.lastSuccessAt)), renderRuntimeCell("Last Error", runtime.lastError ? `${formatTimestamp(runtime.lastErrorAt)} | ${runtime.lastError}` : "n/a"));
    if (roundTrip) {
        const lastCompleted = roundTrip.lastCompleted
            ? `${roundTrip.lastCompleted.status} @ ${formatTimestamp(roundTrip.lastCompleted.at)}`
            : "n/a";
        const lastTimeout = roundTrip.lastTimeout
            ? `${roundTrip.lastTimeout.reason} @ ${formatTimestamp(roundTrip.lastTimeout.at)}`
            : "n/a";
        runtimeStatus.append(renderRuntimeCell("Round-Trip Active", String(roundTrip.activeSessions)), renderRuntimeCell("Round-Trip Retries", String(roundTrip.totals.retriesSent)), renderRuntimeCell("Round-Trip Timeouts", String(roundTrip.totals.timeouts)), renderRuntimeCell("Round-Trip Completed", String(roundTrip.totals.completed)), renderRuntimeCell("Round-Trip Last Completed", lastCompleted), renderRuntimeCell("Round-Trip Last Timeout", lastTimeout));
    }
    if (metrics) {
        runtimeStatus.append(renderRuntimeCell("Wake Detections", String(metrics.eventCounts.wakeDetections)), renderRuntimeCell("Spoken OK", String(metrics.roundTrip.bridgeSpokenOk)), renderRuntimeCell("p95 Latency", metrics.latency.p95Ms === null ? "n/a" : `${metrics.latency.p95Ms}ms`), renderRuntimeCell("Error Rate", formatPercent(metrics.errorRate.value)));
    }
    requestAnimationFrame(() => runtimeStatus.classList.add("pulse"));
}
function appendProfileLine(container, text, strong = false) {
    const el = document.createElement(strong ? "strong" : "small");
    el.textContent = text;
    container.append(el, document.createElement("br"));
}
function profileCard(profile, activeProfileId) {
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
        }
        catch (error) {
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
            await refreshHealth();
        }
        catch (error) {
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
            await refreshHealth();
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), true);
        }
    });
    actions.append(wakeInput, saveWake, activate, remove);
    card.append(actions);
    return card;
}
async function refreshProfiles() {
    if (!profileList) {
        return;
    }
    const data = await api("/v1/profiles");
    profileList.innerHTML = "";
    if (data.profiles.length === 0) {
        appendEmptyState(profileList, "No profiles yet. Save setup above to create your first profile.");
        return;
    }
    for (const profile of data.profiles) {
        profileList.append(profileCard(profile, data.activeProfileId));
    }
}
async function refreshHealth() {
    if (!healthPre) {
        return;
    }
    const health = await api("/v1/health");
    healthPre.textContent = JSON.stringify(health, null, 2);
    renderRuntimeStatus(health.bridgeRuntime, health.roundTrip, health.metrics);
    renderServiceSummary(health);
}
function renderEvent(payload) {
    const item = document.createElement("li");
    item.className = "event-item";
    const top = document.createElement("div");
    top.className = "event-top";
    const type = document.createElement("span");
    type.className = "event-type";
    type.textContent = payload.type;
    const time = document.createElement("span");
    time.className = "event-time";
    time.textContent = formatTimestamp(payload.time);
    top.append(type, time);
    const pre = document.createElement("pre");
    pre.className = "event-payload";
    pre.textContent = JSON.stringify(payload.payload, null, 2);
    item.append(top, pre);
    return item;
}
function bindEvents() {
    if (!eventsList) {
        return;
    }
    const source = new EventSource("/v1/events");
    source.onmessage = (event) => {
        try {
            const parsed = JSON.parse(event.data);
            eventsList.prepend(renderEvent(parsed));
        }
        catch {
            const fallback = document.createElement("li");
            fallback.className = "event-item";
            fallback.textContent = event.data;
            eventsList.prepend(fallback);
        }
        while (eventsList.children.length > 25) {
            eventsList.removeChild(eventsList.lastChild);
        }
    };
}
function bindQuickActions() {
    const refresh = document.querySelector("#refresh-health");
    refresh?.addEventListener("click", async () => {
        try {
            await refreshHealth();
            setStatus("Status refreshed.");
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), true);
        }
    });
    const listenerRestart = document.querySelector("#restart-listener");
    listenerRestart?.addEventListener("click", async () => {
        try {
            await api("/v1/listener/restart", { method: "POST" });
            setStatus("Listener restart requested.");
            await refreshHealth();
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), true);
        }
    });
    const bridgeRestart = document.querySelector("#restart-bridge");
    bridgeRestart?.addEventListener("click", async () => {
        try {
            await api("/v1/bridge/restart", { method: "POST" });
            setStatus("Bridge restart requested.");
            await refreshHealth();
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), true);
        }
    });
    const testButton = document.querySelector("#test-voice");
    testButton?.addEventListener("click", async () => {
        try {
            await api("/v1/speak/test", {
                method: "POST",
                body: JSON.stringify({ text: "Faye is online." })
            });
            setStatus("Voice test played.");
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), true);
        }
    });
}
function bindSetupForm() {
    const form = document.querySelector("#setup-form");
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
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), true);
        }
    });
}
function bindCreateProfileForm() {
    const form = document.querySelector("#create-profile-form");
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
            await refreshHealth();
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), true);
        }
    });
}
async function bootstrap() {
    bindQuickActions();
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
