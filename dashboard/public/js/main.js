"use strict";
const setupStatus = document.querySelector("#setup-status");
const profileList = document.querySelector("#profile-list");
const healthPre = document.querySelector("#health");
const eventsList = document.querySelector("#events");
const runtimeStatus = document.querySelector("#runtime-status");
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
function renderRuntimeStatus(runtime) {
    if (!runtimeStatus) {
        return;
    }
    runtimeStatus.innerHTML = "";
    if (!runtime) {
        runtimeStatus.append(renderRuntimeCell("Bridge Runtime", "No runtime data yet."));
        return;
    }
    runtimeStatus.append(renderRuntimeCell("Bridge State", runtime.state), renderRuntimeCell("Consecutive Errors", String(runtime.consecutiveErrors)), renderRuntimeCell("Backoff", `${runtime.backoffMs}ms`), renderRuntimeCell("Last Update", typeof runtime.lastUpdateId === "number" ? String(runtime.lastUpdateId) : "n/a"), renderRuntimeCell("Last Offset", typeof runtime.lastOffset === "number" ? String(runtime.lastOffset) : "n/a"), renderRuntimeCell("Last Command", runtime.lastCommandType ? `${runtime.lastCommandType} (${runtime.lastCommandStatus ?? "unknown"})` : "n/a"), renderRuntimeCell("Last Success", formatTimestamp(runtime.lastSuccessAt)), renderRuntimeCell("Last Error", runtime.lastError ? `${formatTimestamp(runtime.lastErrorAt)} | ${runtime.lastError}` : "n/a"));
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
    renderRuntimeStatus(health.bridgeRuntime);
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
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), true);
        }
    });
}
function bindEvents() {
    if (!eventsList) {
        return;
    }
    const source = new EventSource("/v1/events");
    source.onmessage = (event) => {
        const li = document.createElement("li");
        li.textContent = event.data;
        eventsList.prepend(li);
        while (eventsList.children.length > 20) {
            eventsList.removeChild(eventsList.lastChild);
        }
    };
}
async function bootstrap() {
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
