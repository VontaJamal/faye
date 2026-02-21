import { bindRecoveryActions } from "./actions/recovery.js";
import { bindCreateProfileForm, bindQuickActions, bindSetupForm, refreshProfiles } from "./actions/setup.js";
import { apiRequest } from "./api/client.js";
import { refreshConversationContext, renderConversationPanel } from "./render/conversation.js";
import { bindEventStream } from "./render/events.js";
import { renderHealthPanels } from "./render/health.js";
import { createDashboardState } from "./state/store.js";
function humanizeCode(code) {
    return code
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}
function displayCode(code) {
    return new URLSearchParams(window.location.search).get("debug") === "1" ? code : humanizeCode(code);
}
export async function bootstrap() {
    const state = createDashboardState();
    const setStatus = (message, error = false) => {
        if (!state.elements.setupStatus) {
            return;
        }
        state.elements.setupStatus.textContent = message;
        state.elements.setupStatus.classList.toggle("error", error);
    };
    const setRecoveryStatus = (message, error = false) => {
        if (!state.elements.recoveryStatus) {
            return;
        }
        state.elements.recoveryStatus.textContent = message;
        state.elements.recoveryStatus.classList.toggle("error", error);
    };
    const refreshHealth = async () => {
        const healthPre = state.elements.healthPre;
        if (!healthPre) {
            return;
        }
        if (state.refreshHealthInFlight) {
            return state.refreshHealthInFlight;
        }
        const run = (async () => {
            const health = await apiRequest("/v1/health");
            state.latestHealth = health;
            healthPre.textContent = JSON.stringify(health, null, 2);
            renderHealthPanels(state, health);
            renderConversationPanel(state, health, apiRequest, displayCode);
        })().finally(() => {
            if (state.refreshHealthInFlight === run) {
                state.refreshHealthInFlight = null;
            }
        });
        state.refreshHealthInFlight = run;
        return run;
    };
    bindQuickActions({
        state,
        apiRequest,
        setStatus,
        refreshHealth
    });
    bindRecoveryActions({
        state,
        apiRequest,
        setRecoveryStatus,
        refreshHealth
    });
    bindSetupForm({
        state,
        apiRequest,
        setStatus,
        refreshHealth
    });
    bindCreateProfileForm({
        state,
        apiRequest,
        setStatus,
        refreshHealth
    });
    const stopEventStream = bindEventStream(state, displayCode);
    await refreshProfiles({
        state,
        apiRequest,
        setStatus,
        refreshHealth
    });
    await refreshHealth();
    state.refreshHealthIntervalId = window.setInterval(() => {
        void refreshHealth();
    }, 15_000);
    state.refreshContextIntervalId = window.setInterval(() => {
        if (state.activeConversationSessionId) {
            void refreshConversationContext(state, state.activeConversationSessionId, apiRequest, displayCode);
        }
    }, 4_000);
    let disposed = false;
    const dispose = () => {
        if (disposed) {
            return;
        }
        disposed = true;
        if (state.refreshHealthIntervalId !== null) {
            window.clearInterval(state.refreshHealthIntervalId);
            state.refreshHealthIntervalId = null;
        }
        if (state.refreshContextIntervalId !== null) {
            window.clearInterval(state.refreshContextIntervalId);
            state.refreshContextIntervalId = null;
        }
        if (state.eventReconnectTimer !== null) {
            window.clearTimeout(state.eventReconnectTimer);
            state.eventReconnectTimer = null;
        }
        stopEventStream();
    };
    window.addEventListener("beforeunload", dispose, { once: true });
    window.addEventListener("pagehide", dispose, { once: true });
}
