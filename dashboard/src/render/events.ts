import { DEBUG_MODE, EVENT_LABELS, type DashboardState, type StreamEvent } from "../state/store.js";

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

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function eventTitle(type: string, displayCode: (code: string) => string): string {
  if (DEBUG_MODE) {
    return type;
  }
  return EVENT_LABELS[type] ?? displayCode(type);
}

function listenerStatusSummary(status: string, displayCode: (code: string) => string): string {
  const map: Record<string, string> = {
    started: "Listener started and is waiting for your wake phrase.",
    conversation_loop_started: "Conversation session started.",
    conversation_loop_extended: "Conversation session extended with extra turns.",
    conversation_loop_ended: "Conversation session ended."
  };
  return map[status] ?? `Listener status: ${displayCode(status)}.`;
}

function eventSummary(event: StreamEvent, displayCode: (code: string) => string): string {
  const payload = asObject(event.payload) ?? {};
  switch (event.type) {
    case "wake_detected": {
      const heard = asNonEmptyString(payload.heard);
      const wakeWord = asNonEmptyString(payload.wake_word);
      if (heard && wakeWord) {
        return `Heard "${heard}" and matched wake phrase "${wakeWord}".`;
      }
      if (heard) {
        return `Heard "${heard}" and started listening.`;
      }
      return "Wake phrase matched. Faye is listening.";
    }
    case "wake_variant_learned": {
      const variant = asNonEmptyString(payload.variant);
      const wakeWord = asNonEmptyString(payload.wake_word);
      if (variant && wakeWord) {
        return `Learned "${variant}" as an alternate phrase for "${wakeWord}".`;
      }
      if (variant) {
        return `Learned "${variant}" as an alternate wake phrase.`;
      }
      return "Learned a new alternate wake phrase.";
    }
    case "message_transcribed": {
      const text = asNonEmptyString(payload.text);
      const turn = asFiniteNumber(payload.turn);
      const turnPart = turn !== null ? ` (turn ${turn})` : "";
      if (text) {
        return `Captured your speech${turnPart}: "${text}".`;
      }
      return `Captured your speech${turnPart}.`;
    }
    case "listener_error": {
      const code = asNonEmptyString(payload.code);
      const status = asFiniteNumber(payload.status);
      if (code && status !== null) {
        return `Listener error ${code} (status ${status}).`;
      }
      if (code) {
        return `Listener error ${code}.`;
      }
      return "Listener encountered an error.";
    }
    case "listener_status": {
      const status = asNonEmptyString(payload.status);
      if (status) {
        return listenerStatusSummary(status, displayCode);
      }
      return "Listener status updated.";
    }
    case "conversation_turn_started": {
      const turn = asFiniteNumber(payload.turn);
      return turn !== null ? `Started conversation turn ${turn}.` : "Started a conversation turn.";
    }
    case "conversation_turn_completed": {
      const turn = asFiniteNumber(payload.turn);
      const waitResult = asNonEmptyString(payload.wait_result);
      if (turn !== null && waitResult) {
        return `Completed turn ${turn} with result "${displayCode(waitResult)}".`;
      }
      if (turn !== null) {
        return `Completed turn ${turn}.`;
      }
      return "Completed a conversation turn.";
    }
    case "bridge_speak_received":
      return "Agent response was received and queued for voice playback.";
    case "bridge_spoken": {
      const status = asNonEmptyString(payload.status);
      if (status) {
        return `Agent voice reply finished with status "${displayCode(status)}".`;
      }
      return "Agent voice reply was played.";
    }
    case "bridge_action_requested": {
      const name = asNonEmptyString(payload.name);
      return name ? `Requested action "${displayCode(name)}".` : "Requested an action.";
    }
    case "bridge_action_executed": {
      const name = asNonEmptyString(payload.name);
      return name ? `Completed action "${displayCode(name)}".` : "Completed an action.";
    }
    case "bridge_action_blocked": {
      const name = asNonEmptyString(payload.name);
      return name
        ? `Action "${displayCode(name)}" is waiting for confirmation.`
        : "Action is waiting for confirmation.";
    }
    case "system_panic_stop_requested":
      return "Panic Stop requested. Listener and bridge are being halted.";
    case "system_panic_stop_completed": {
      const ok = payload.ok === true;
      return ok
        ? "Panic Stop completed. You can restart services when ready."
        : "Panic Stop completed with warnings. Check status before continuing.";
    }
    case "system_factory_reset_requested":
      return "Factory Reset requested. Preparing archive and clean reset.";
    case "system_factory_reset_completed": {
      const ok = payload.ok === true;
      return ok
        ? "Factory Reset completed. Start install flow again from scratch."
        : "Factory Reset completed with warnings. Review recovery status.";
    }
    default:
      return "Activity updated.";
  }
}

function renderEvent(payload: StreamEvent, displayCode: (code: string) => string): HTMLElement {
  const item = document.createElement("li");
  item.className = "event-item";

  const top = document.createElement("div");
  top.className = "event-top";

  const type = document.createElement("span");
  type.className = "event-type";
  type.textContent = eventTitle(payload.type, displayCode);

  const time = document.createElement("span");
  time.className = "event-time";
  time.textContent = formatTimestamp(payload.time);

  top.append(type, time);
  item.append(top);

  const summary = document.createElement("p");
  summary.className = "event-summary";
  summary.textContent = eventSummary(payload, displayCode);
  item.append(summary);

  if (DEBUG_MODE) {
    const pre = document.createElement("pre");
    pre.className = "event-payload";
    pre.textContent = JSON.stringify(payload.payload, null, 2);
    item.append(pre);
  }

  return item;
}

export function bindEventStream(
  state: DashboardState,
  displayCode: (code: string) => string,
  onConnectionStatus?: (message: string, error?: boolean) => void
): () => void {
  const eventsList = state.elements.eventsList;
  if (!eventsList) {
    return () => undefined;
  }

  let disposed = false;

  const clearReconnectTimer = (): void => {
    if (state.eventReconnectTimer !== null) {
      window.clearTimeout(state.eventReconnectTimer);
      state.eventReconnectTimer = null;
    }
  };

  const closeSource = (): void => {
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }
  };

  const scheduleReconnect = (): void => {
    if (disposed || state.eventReconnectTimer !== null) {
      return;
    }

    const nextAttempt = Math.min(6, state.eventReconnectAttempts + 1);
    state.eventReconnectAttempts = nextAttempt;
    const delayMs = Math.min(10_000, 500 * 2 ** (nextAttempt - 1));

    onConnectionStatus?.(`Event stream disconnected. Reconnecting in ${Math.round(delayMs / 1000)}s...`, true);

    state.eventReconnectTimer = window.setTimeout(() => {
      state.eventReconnectTimer = null;
      connect();
    }, delayMs);
  };

  const connect = (): void => {
    if (disposed) {
      return;
    }

    closeSource();
    clearReconnectTimer();

    const source = new EventSource("/v1/events");
    state.eventSource = source;

    source.onopen = () => {
      state.eventReconnectAttempts = 0;
      onConnectionStatus?.("Event stream connected.", false);
    };

    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as StreamEvent;
        eventsList.prepend(renderEvent(parsed, displayCode));
      } catch {
        const fallback = document.createElement("li");
        fallback.className = "event-item";
        fallback.textContent = event.data;
        eventsList.prepend(fallback);
      }

      while (eventsList.children.length > 25) {
        eventsList.removeChild(eventsList.lastChild as Node);
      }
    };

    source.onerror = () => {
      closeSource();
      scheduleReconnect();
    };
  };

  connect();

  return () => {
    disposed = true;
    clearReconnectTimer();
    closeSource();
  };
}
