import type { BridgeActionName } from "./types";

type BridgeActionCommand = {
  type: "action";
  name: BridgeActionName;
  sessionId?: string;
  confirm?: boolean;
};

export type BridgeCommand =
  | { type: "speak"; text: string; sessionId?: string; turn?: number }
  | BridgeActionCommand
  | { type: "activate_profile"; profileId: string }
  | { type: "ping" };

function trimQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function extractSessionId(payload: string): string | undefined {
  const match = payload.match(/\bsession=([A-Za-z0-9._:-]+)/i);
  return match?.[1];
}

function toActionName(value: unknown): BridgeActionName | undefined {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    text === "health_summary" ||
    text === "voice_test" ||
    text === "listener_restart" ||
    text === "bridge_restart"
  ) {
    return text;
  }
  return undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "yes" || normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "no" || normalized === "false" || normalized === "0") {
      return false;
    }
  }
  return undefined;
}

function toTurnValue(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isInteger(input) && input > 0 && input <= 500) {
    return input;
  }

  if (typeof input === "string" && /^\d+$/.test(input)) {
    const parsed = Number(input);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 500) {
      return parsed;
    }
  }

  return undefined;
}

function extractTurn(payload: string): number | undefined {
  const match = payload.match(/\bturn=(\d{1,3})\b/i);
  return toTurnValue(match?.[1]);
}

function extractKeyValueText(payload: string): string | undefined {
  const match = payload.match(/\btext=(.+)$/is);
  if (!match?.[1]) {
    return undefined;
  }
  return trimQuotes(match[1]);
}

function parseSpeakPayload(payload: string): { text: string; sessionId?: string; turn?: number } | null {
  const raw = payload.trim();
  if (!raw) {
    return null;
  }

  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
      const sessionId =
        typeof parsed.session_id === "string"
          ? parsed.session_id
          : typeof parsed.sessionId === "string"
            ? parsed.sessionId
            : undefined;
      const turn = toTurnValue(parsed.turn);

      if (!text) {
        return null;
      }

      return { text, sessionId, turn };
    } catch {
      return null;
    }
  }

  const kvText = extractKeyValueText(raw);
  const sessionId = extractSessionId(raw);
  const turn = extractTurn(raw);
  if (kvText) {
    return { text: kvText, sessionId, turn };
  }

  return { text: trimQuotes(raw), sessionId, turn };
}

function parseActionPayload(payload: string): { name: BridgeActionName; sessionId?: string; confirm?: boolean } | null {
  const raw = payload.trim();
  if (!raw) {
    return null;
  }

  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const name = toActionName(parsed.name);
      if (!name) {
        return null;
      }

      const sessionId =
        typeof parsed.session_id === "string"
          ? parsed.session_id
          : typeof parsed.sessionId === "string"
            ? parsed.sessionId
            : undefined;
      const confirm = toBoolean(parsed.confirm);
      return {
        name,
        sessionId,
        ...(typeof confirm === "boolean" ? { confirm } : {})
      };
    } catch {
      return null;
    }
  }

  const nameMatch = raw.match(/\bname=([a-z_]+)/i);
  const firstToken = raw.split(/\s+/)[0];
  const name = toActionName(nameMatch?.[1] ?? firstToken ?? "");
  if (!name) {
    return null;
  }

  const sessionId = extractSessionId(raw);
  const confirmMatch = raw.match(/\bconfirm=([a-z0-9]+)/i);
  const confirm = toBoolean(confirmMatch?.[1]);

  return {
    name,
    sessionId,
    ...(typeof confirm === "boolean" ? { confirm } : {})
  };
}

function parseProfileId(payload: string): string | null {
  const raw = payload.trim();
  if (!raw) {
    return null;
  }

  const kvMatch = raw.match(/\bid=([A-Za-z0-9-]{3,64})/i);
  if (kvMatch?.[1]) {
    return kvMatch[1];
  }

  const plain = trimQuotes(raw);
  if (/^[A-Za-z0-9-]{3,64}$/.test(plain)) {
    return plain;
  }

  return null;
}

export function parseBridgeCommand(text: string): BridgeCommand | null {
  const message = text.trim();
  if (!message.startsWith("#")) {
    return null;
  }

  if (/^#faye_ping\b/i.test(message)) {
    return { type: "ping" };
  }

  const speakMatch = message.match(/^#faye_speak\b([\s\S]*)$/i);
  if (speakMatch) {
    const parsed = parseSpeakPayload(speakMatch[1] ?? "");
    if (!parsed || !parsed.text) {
      return null;
    }
    return {
      type: "speak",
      text: parsed.text,
      sessionId: parsed.sessionId,
      ...(typeof parsed.turn === "number" ? { turn: parsed.turn } : {})
    };
  }

  const activateMatch = message.match(/^#faye_profile_activate\b([\s\S]*)$/i);
  if (activateMatch) {
    const profileId = parseProfileId(activateMatch[1] ?? "");
    if (!profileId) {
      return null;
    }
    return {
      type: "activate_profile",
      profileId
    };
  }

  const actionMatch = message.match(/^#faye_action\b([\s\S]*)$/i);
  if (actionMatch) {
    const parsed = parseActionPayload(actionMatch[1] ?? "");
    if (!parsed) {
      return null;
    }
    return {
      type: "action",
      name: parsed.name,
      sessionId: parsed.sessionId,
      ...(typeof parsed.confirm === "boolean" ? { confirm: parsed.confirm } : {})
    };
  }

  return null;
}
