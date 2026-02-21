export const FIELD_MAX = {
    profileName: 80,
    apiKey: 300,
    voiceId: 128,
    voiceName: 128,
    wakeWord: 120,
    telegramToken: 300,
    telegramChatId: 64
};
export const PANIC_STOP_CONFIRMATION = "PANIC STOP";
export const FACTORY_RESET_CONFIRMATION = "FACTORY RESET";
export const DEBUG_MODE = new URLSearchParams(window.location.search).get("debug") === "1";
export const EVENT_LABELS = {
    wake_detected: "Wake Word Heard",
    wake_variant_learned: "Wake Phrase Learned",
    message_transcribed: "Voice Captured",
    listener_error: "Listener Issue",
    listener_status: "Listener Update",
    conversation_turn_started: "Conversation Turn Started",
    conversation_turn_completed: "Conversation Turn Completed",
    bridge_speak_received: "Agent Reply Received",
    bridge_spoken: "Agent Reply Played",
    bridge_action_requested: "Action Requested",
    bridge_action_executed: "Action Completed",
    bridge_action_blocked: "Action Needs Confirmation",
    system_panic_stop_requested: "Panic Stop Requested",
    system_panic_stop_completed: "Panic Stop Completed",
    system_factory_reset_requested: "Factory Reset Requested",
    system_factory_reset_completed: "Factory Reset Completed"
};
export function queryDashboardElements() {
    return {
        setupStatus: document.querySelector("#setup-status"),
        setupValidationSummary: document.querySelector("#setup-validation-summary"),
        profileList: document.querySelector("#profile-list"),
        healthPre: document.querySelector("#health"),
        eventsList: document.querySelector("#events"),
        runtimeStatus: document.querySelector("#runtime-status"),
        serviceSummary: document.querySelector("#service-summary"),
        firstSuccessChecklist: document.querySelector("#first-success-checklist"),
        conversationState: document.querySelector("#conversation-state"),
        conversationBadges: document.querySelector("#conversation-badges"),
        conversationTurns: document.querySelector("#conversation-turns"),
        conversationContext: document.querySelector("#conversation-context"),
        conversationEnd: document.querySelector("#conversation-end"),
        panicConfirmationInput: document.querySelector("#panic-confirmation"),
        factoryResetConfirmationInput: document.querySelector("#factory-reset-confirmation"),
        panicStopButton: document.querySelector("#panic-stop-button"),
        factoryResetButton: document.querySelector("#factory-reset-button"),
        recoveryStatus: document.querySelector("#recovery-status")
    };
}
export function createDashboardState() {
    return {
        elements: queryDashboardElements(),
        latestHealth: null,
        activeConversationSessionId: null,
        refreshHealthInFlight: null,
        eventSource: null,
        eventReconnectTimer: null,
        eventReconnectAttempts: 0,
        refreshHealthIntervalId: null,
        refreshContextIntervalId: null
    };
}
