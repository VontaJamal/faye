import { apiKeyReadyForActiveProfile } from "../render/health.js";
import { FIELD_MAX } from "../state/store.js";
function optionalField(value) {
    const text = String(value ?? "").trim();
    return text.length > 0 ? text : undefined;
}
function appendEmptyState(container, text) {
    const div = document.createElement("div");
    div.className = "empty-state";
    div.textContent = text;
    container.append(div);
}
function appendProfileLine(container, text, strong = false) {
    const el = document.createElement(strong ? "strong" : "small");
    el.textContent = text;
    container.append(el, document.createElement("br"));
}
function clearSetupValidationState(form, summary) {
    form.querySelectorAll("[data-setup-field]").forEach((input) => {
        input.classList.remove("input-invalid");
        input.setAttribute("aria-invalid", "false");
    });
    form.querySelectorAll("[data-setup-error]").forEach((fieldError) => {
        fieldError.textContent = "";
    });
    if (summary) {
        summary.innerHTML = "";
        summary.classList.remove("visible");
    }
}
function renderSetupValidationState(form, summary, errors) {
    clearSetupValidationState(form, summary);
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
    if (summary && entries.length > 0) {
        const list = document.createElement("ul");
        for (const [, message] of entries) {
            const item = document.createElement("li");
            item.textContent = message;
            list.append(item);
        }
        const intro = document.createElement("p");
        intro.textContent = "Please fix these fields before continuing:";
        summary.innerHTML = "";
        summary.append(intro, list);
        summary.classList.add("visible");
    }
}
function validateSetupPayload(state, form) {
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
    if (!apiKeyReadyForActiveProfile(state) && !apiKey) {
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
function profileCard(profile, activeProfileId, deps) {
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
                deps.setStatus("Wake word cannot be empty.", true);
                return;
            }
            await deps.apiRequest(`/v1/profiles/${profile.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                    wakeWord,
                    wakeWordVariants: [wakeWord.toLowerCase()]
                })
            });
            deps.setStatus(`Wake word updated for ${profile.name}`);
            await refreshProfiles(deps);
            await deps.refreshHealth();
        }
        catch (error) {
            deps.setStatus(error instanceof Error ? error.message : String(error), true);
        }
    });
    const activate = document.createElement("button");
    activate.textContent = "Activate";
    activate.className = "secondary";
    activate.addEventListener("click", async () => {
        try {
            await deps.apiRequest(`/v1/profiles/${profile.id}/activate`, { method: "POST" });
            deps.setStatus(`Activated ${profile.name}`);
            await refreshProfiles(deps);
            await deps.refreshHealth();
        }
        catch (error) {
            deps.setStatus(error instanceof Error ? error.message : String(error), true);
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
            await deps.apiRequest(`/v1/profiles/${profile.id}`, { method: "DELETE" });
            deps.setStatus(`Deleted ${profile.name}`);
            await refreshProfiles(deps);
            await deps.refreshHealth();
        }
        catch (error) {
            deps.setStatus(error instanceof Error ? error.message : String(error), true);
        }
    });
    actions.append(wakeInput, saveWake, activate, remove);
    card.append(actions);
    return card;
}
export async function refreshProfiles(deps) {
    const profileList = deps.state.elements.profileList;
    if (!profileList) {
        return;
    }
    const data = await deps.apiRequest("/v1/profiles");
    profileList.innerHTML = "";
    if (data.profiles.length === 0) {
        appendEmptyState(profileList, "No profiles yet. Save setup above to create your first profile.");
        return;
    }
    for (const profile of data.profiles) {
        profileList.append(profileCard(profile, data.activeProfileId, deps));
    }
}
export function bindSetupForm(deps) {
    const form = document.querySelector("#setup-form");
    if (!form) {
        return;
    }
    const summary = deps.state.elements.setupValidationSummary;
    form.querySelectorAll("[data-setup-field]").forEach((input) => {
        input.addEventListener("input", () => {
            const field = input.getAttribute("data-setup-field");
            if (!field) {
                return;
            }
            const errors = {};
            if (field === "telegramToken" || field === "telegramChatId") {
                renderSetupValidationState(form, summary, errors);
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
        const validated = validateSetupPayload(deps.state, form);
        if (!validated.payload) {
            renderSetupValidationState(form, summary, validated.errors);
            deps.setStatus("Setup blocked until validation errors are fixed.", true);
            return;
        }
        clearSetupValidationState(form, summary);
        try {
            await deps.apiRequest("/v1/setup", {
                method: "POST",
                body: JSON.stringify(validated.payload)
            });
            deps.setStatus("Setup saved.");
            await refreshProfiles(deps);
            await deps.refreshHealth();
        }
        catch (error) {
            deps.setStatus(error instanceof Error ? error.message : String(error), true);
        }
    });
}
export function bindCreateProfileForm(deps) {
    const form = document.querySelector("#create-profile-form");
    if (!form) {
        return;
    }
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        try {
            await deps.apiRequest("/v1/profiles", {
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
            deps.setStatus("Profile created.");
            form.reset();
            await refreshProfiles(deps);
            await deps.refreshHealth();
        }
        catch (error) {
            deps.setStatus(error instanceof Error ? error.message : String(error), true);
        }
    });
}
export function bindQuickActions(deps) {
    const refresh = document.querySelector("#refresh-health");
    refresh?.addEventListener("click", async () => {
        try {
            await deps.refreshHealth();
            deps.setStatus("Status refreshed.");
        }
        catch (error) {
            deps.setStatus(error instanceof Error ? error.message : String(error), true);
        }
    });
    const listenerRestart = document.querySelector("#restart-listener");
    listenerRestart?.addEventListener("click", async () => {
        try {
            await deps.apiRequest("/v1/listener/restart", { method: "POST" });
            deps.setStatus("Listener restart requested.");
            await deps.refreshHealth();
        }
        catch (error) {
            deps.setStatus(error instanceof Error ? error.message : String(error), true);
        }
    });
    const bridgeRestart = document.querySelector("#restart-bridge");
    bridgeRestart?.addEventListener("click", async () => {
        try {
            await deps.apiRequest("/v1/bridge/restart", { method: "POST" });
            deps.setStatus("Bridge restart requested.");
            await deps.refreshHealth();
        }
        catch (error) {
            deps.setStatus(error instanceof Error ? error.message : String(error), true);
        }
    });
    const testButton = document.querySelector("#test-voice");
    testButton?.addEventListener("click", async () => {
        try {
            await deps.apiRequest("/v1/speak/test", {
                method: "POST",
                body: JSON.stringify({ text: "Faye is online." })
            });
            deps.setStatus("Voice test played.");
            await deps.refreshHealth();
        }
        catch (error) {
            deps.setStatus(error instanceof Error ? error.message : String(error), true);
            await deps.refreshHealth().catch(() => undefined);
        }
    });
    deps.state.elements.conversationEnd?.addEventListener("click", async () => {
        if (!deps.state.activeConversationSessionId) {
            deps.setStatus("No active conversation session to end.");
            return;
        }
        try {
            await deps.apiRequest(`/v1/conversation/${encodeURIComponent(deps.state.activeConversationSessionId)}/end`, {
                method: "POST",
                body: JSON.stringify({
                    reason: "external_stop"
                })
            });
            deps.setStatus("Force stop requested for active conversation session.");
            await deps.refreshHealth();
        }
        catch (error) {
            deps.setStatus(error instanceof Error ? error.message : String(error), true);
        }
    });
}
