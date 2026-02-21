"use strict";
const FIELD_MAX = {
    profileName: 80,
    apiKey: 300,
    voiceId: 128,
    voiceName: 128,
    wakeWord: 120,
    telegramToken: 300,
    telegramChatId: 64
};
const setupStatus = document.querySelector("#setup-status");
const setupValidationSummary = document.querySelector("#setup-validation-summary");
const profileList = document.querySelector("#profile-list");
const healthPre = document.querySelector("#health");
const eventsList = document.querySelector("#events");
const runtimeStatus = document.querySelector("#runtime-status");
const serviceSummary = document.querySelector("#service-summary");
const firstSuccessChecklist = document.querySelector("#first-success-checklist");
const conversationState = document.querySelector("#conversation-state");
const conversationTurns = document.querySelector("#conversation-turns");
const conversationEnd = document.querySelector("#conversation-end");
let latestHealth = null;
let activeConversationSessionId = null;
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
function formatDuration(valueMs) {
    if (valueMs === null) {
        return "n/a";
    }
    const minutes = valueMs / 60_000;
    return `${minutes.toFixed(1)} min`;
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
function itemFromOnboarding(health, itemId) {
    const items = health?.onboarding?.checklist.items ?? [];
    return items.find((item) => item.id === itemId) ?? null;
}
function apiKeyReadyForActiveProfile() {
    return itemFromOnboarding(latestHealth, "api-key-ready")?.ok === true;
}
function renderServiceSummary(health) {
    if (!serviceSummary) {
        return;
    }
    serviceSummary.innerHTML = "";
    const listener = health.services?.listener;
    const dashboard = health.services?.dashboard;
    const bridge = health.services?.bridge;
    const checklist = health.onboarding?.checklist;
    serviceSummary.append(makeChip("Doctor", health.doctor?.ok === true ? "ok" : "attention", health.doctor?.ok === true ? "good" : "bad"), makeChip("Listener", listener?.code === 0 ? "running" : "down", classifyService(listener)), makeChip("Dashboard", dashboard?.code === 0 ? "running" : "down", classifyService(dashboard)), makeChip("Bridge", bridge?.code === 0 ? "running" : "down", classifyService(bridge)), makeChip("p95", health.metrics?.latency.p95Ms === null || health.metrics?.latency.p95Ms === undefined
        ? "n/a"
        : `${health.metrics.latency.p95Ms}ms`, classifyLatency(health.metrics?.latency.p95Ms ?? null)), makeChip("Error Rate", formatPercent(health.metrics?.errorRate.value ?? null), classifyErrorRate(health.metrics?.errorRate.value ?? null)));
    if (checklist) {
        serviceSummary.append(makeChip("First Success", `${checklist.completed}/${checklist.total}`, checklist.completed === checklist.total ? "good" : "warn"));
    }
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
function renderFirstSuccessChecklist(health) {
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
function formatConversationState(state) {
    if (state === "awaiting_assistant") {
        return "Waiting for assistant response";
    }
    if (state === "agent_responding") {
        return "Assistant response in progress";
    }
    if (state === "ended") {
        return "Ended";
    }
    return "Waiting for your next message";
}
function renderConversationPanel(health) {
    if (!conversationState || !conversationTurns || !conversationEnd) {
        return;
    }
    conversationState.innerHTML = "";
    conversationTurns.innerHTML = "";
    activeConversationSessionId = null;
    const snapshot = health.conversation;
    if (!snapshot) {
        appendEmptyState(conversationState, "Conversation state is not available yet.");
        conversationEnd.disabled = true;
        return;
    }
    const active = snapshot.sessions.find((session) => session.state !== "ended") ?? snapshot.sessions[0] ?? null;
    const headline = document.createElement("div");
    headline.className = "conversation-headline";
    headline.innerHTML = [
        `Active sessions: <strong>${snapshot.activeSessions}</strong>`,
        `Retained sessions: <strong>${snapshot.retainedSessions}</strong>`,
        `Policy: <strong>${snapshot.policy.turnPolicy.baseTurns}+${snapshot.policy.turnPolicy.extendBy}</strong> up to <strong>${snapshot.policy.turnPolicy.hardCap}</strong> turns`,
        `Context TTL: <strong>${Math.round(snapshot.policy.ttlMs / 60000)} min</strong>`
    ]
        .map((line) => `<p>${line}</p>`)
        .join("");
    conversationState.append(headline);
    if (!active) {
        appendEmptyState(conversationTurns, "No active conversation yet. Trigger wake word to begin.");
        conversationEnd.disabled = true;
        return;
    }
    activeConversationSessionId = active.state === "ended" ? null : active.sessionId;
    const statusCard = document.createElement("div");
    statusCard.className = `conversation-status-card ${active.state === "ended" ? "ended" : "active"}`;
    statusCard.innerHTML = [
        `<p><strong>Session</strong>: ${active.sessionId}</p>`,
        `<p><strong>Status</strong>: ${formatConversationState(active.state)}</p>`,
        `<p><strong>Turn progress</strong>: ${active.totalTurns}/${active.turnLimit}</p>`,
        `<p><strong>Retained turns</strong>: ${active.retainedTurns}</p>`,
        `<p><strong>Expires</strong>: ${formatTimestamp(active.expiresAt)} (${Math.ceil(active.expiresInMs / 1000)}s)</p>`,
        active.endReason ? `<p><strong>End reason</strong>: ${active.endReason}</p>` : ""
    ].join("");
    conversationState.append(statusCard);
    const retainedTurns = active.turns.slice(-6);
    if (retainedTurns.length === 0) {
        appendEmptyState(conversationTurns, "No retained turns yet.");
    }
    else {
        for (const turn of retainedTurns) {
            const item = document.createElement("li");
            item.className = "conversation-turn";
            item.innerHTML = [
                `<p class=\"conversation-turn-title\">Turn ${turn.turn}</p>`,
                `<p><strong>You</strong>: ${turn.userText ?? "n/a"}</p>`,
                `<p><strong>Agent</strong>: ${turn.assistantText ?? "pending"}</p>`,
                `<p><strong>Agent status</strong>: ${turn.assistantStatus ?? "n/a"}</p>`
            ].join("");
            conversationTurns.append(item);
        }
    }
    conversationEnd.disabled = activeConversationSessionId === null;
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
            await refreshHealth();
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
    latestHealth = health;
    healthPre.textContent = JSON.stringify(health, null, 2);
    renderRuntimeStatus(health.bridgeRuntime, health.roundTrip, health.metrics);
    renderServiceSummary(health);
    renderFirstSuccessChecklist(health);
    renderConversationPanel(health);
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
function clearSetupValidationState(form) {
    form.querySelectorAll("[data-setup-field]").forEach((input) => {
        input.classList.remove("input-invalid");
        input.setAttribute("aria-invalid", "false");
    });
    form.querySelectorAll("[data-setup-error]").forEach((fieldError) => {
        fieldError.textContent = "";
    });
    if (setupValidationSummary) {
        setupValidationSummary.innerHTML = "";
        setupValidationSummary.classList.remove("visible");
    }
}
function renderSetupValidationState(form, errors) {
    clearSetupValidationState(form);
    const entries = Object.entries(errors);
    for (const [field, message] of entries) {
        const input = form.querySelector(`[data-setup-field="${field}"]`);
        const fieldError = form.querySelector(`[data-setup-error="${field}"]`);
        if (input) {
            input.classList.add("input-invalid");
            input.setAttribute("aria-invalid", "true");
        }
        if (fieldError) {
            fieldError.textContent = message;
        }
    }
    if (setupValidationSummary && entries.length > 0) {
        const list = document.createElement("ul");
        for (const [, message] of entries) {
            const item = document.createElement("li");
            item.textContent = message;
            list.append(item);
        }
        const intro = document.createElement("p");
        intro.textContent = "Please fix these fields before continuing:";
        setupValidationSummary.innerHTML = "";
        setupValidationSummary.append(intro, list);
        setupValidationSummary.classList.add("visible");
    }
}
function validateSetupPayload(form) {
    const data = new FormData(form);
    const profileName = String(data.get("profileName") ?? "").trim();
    const apiKey = optionalField(data.get("apiKey"));
    const voiceId = String(data.get("voiceId") ?? "").trim();
    const voiceName = String(data.get("voiceName") ?? "").trim();
    const wakeWord = String(data.get("wakeWord") ?? "").trim();
    const telegramToken = optionalField(data.get("telegramToken"));
    const telegramChatId = optionalField(data.get("telegramChatId"));
    const errors = {};
    if (profileName.length === 0) {
        errors.profileName = "Profile name is required.";
    }
    else if (profileName.length > FIELD_MAX.profileName) {
        errors.profileName = `Profile name must be ${FIELD_MAX.profileName} characters or fewer.`;
    }
    if (voiceId.length === 0) {
        errors.voiceId = "Voice ID is required.";
    }
    else if (voiceId.length > FIELD_MAX.voiceId) {
        errors.voiceId = `Voice ID must be ${FIELD_MAX.voiceId} characters or fewer.`;
    }
    if (voiceName.length === 0) {
        errors.voiceName = "Voice name is required.";
    }
    else if (voiceName.length > FIELD_MAX.voiceName) {
        errors.voiceName = `Voice name must be ${FIELD_MAX.voiceName} characters or fewer.`;
    }
    if (wakeWord.length === 0) {
        errors.wakeWord = "Wake word is required.";
    }
    else if (wakeWord.length > FIELD_MAX.wakeWord) {
        errors.wakeWord = `Wake word must be ${FIELD_MAX.wakeWord} characters or fewer.`;
    }
    if (!apiKeyReadyForActiveProfile() && !apiKey) {
        errors.apiKey = "API key is required until health confirms a valid active key (0600).";
    }
    if (apiKey && apiKey.length > FIELD_MAX.apiKey) {
        errors.apiKey = "API key appears too long. Please paste a valid key.";
    }
    const hasToken = Boolean(telegramToken);
    const hasChatId = Boolean(telegramChatId);
    if (hasToken !== hasChatId) {
        if (!hasToken) {
            errors.telegramToken = "Telegram bot token is required when chat ID is provided.";
        }
        if (!hasChatId) {
            errors.telegramChatId = "Telegram chat ID is required when bot token is provided.";
        }
    }
    if (telegramChatId && telegramChatId.length > FIELD_MAX.telegramChatId) {
        errors.telegramChatId = `Telegram chat ID must be ${FIELD_MAX.telegramChatId} characters or fewer.`;
    }
    if (Object.keys(errors).length > 0) {
        return { payload: null, errors };
    }
    return {
        payload: {
            profileName,
            apiKey,
            voiceId,
            voiceName,
            wakeWord,
            telegramToken,
            telegramChatId
        },
        errors
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
            await refreshHealth();
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), true);
            await refreshHealth().catch(() => undefined);
        }
    });
    conversationEnd?.addEventListener("click", async () => {
        if (!activeConversationSessionId) {
            setStatus("No active conversation session to end.");
            return;
        }
        try {
            await api(`/v1/conversation/${encodeURIComponent(activeConversationSessionId)}/end`, {
                method: "POST",
                body: JSON.stringify({
                    reason: "dashboard_manual_end"
                })
            });
            setStatus("Conversation session ended.");
            await refreshHealth();
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
    form.querySelectorAll("[data-setup-field]").forEach((input) => {
        input.addEventListener("input", () => {
            const field = input.getAttribute("data-setup-field");
            if (!field) {
                return;
            }
            const errors = {};
            if (field === "telegramToken" || field === "telegramChatId") {
                renderSetupValidationState(form, errors);
                return;
            }
            const fieldError = form.querySelector(`[data-setup-error="${field}"]`);
            if (fieldError) {
                fieldError.textContent = "";
            }
            input.classList.remove("input-invalid");
            input.setAttribute("aria-invalid", "false");
        });
    });
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const validated = validateSetupPayload(form);
        if (!validated.payload) {
            renderSetupValidationState(form, validated.errors);
            setStatus("Setup blocked until validation errors are fixed.", true);
            return;
        }
        clearSetupValidationState(form);
        try {
            await api("/v1/setup", {
                method: "POST",
                body: JSON.stringify(validated.payload)
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
