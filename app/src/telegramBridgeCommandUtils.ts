import type { BridgeCommand } from "./telegramBridgeParser";

export type ActionResultStatus = "ok" | "error" | "needs_confirm";

export function bridgeCommandKey(command: BridgeCommand, updateId: number): string {
  if (command.type === "speak") {
    return command.sessionId ? `speak:session:${command.sessionId}:update:${updateId}` : `speak:update:${updateId}`;
  }
  if (command.type === "action") {
    const sessionPart = command.sessionId ? `:session:${command.sessionId}` : "";
    if (command.nonce) {
      return `action:${command.name}${sessionPart}:nonce:${command.nonce}`;
    }
    return `action:${command.name}${sessionPart}:update:${updateId}`;
  }
  if (command.type === "activate_profile") {
    return `activate:${command.profileId}:update:${updateId}`;
  }
  return `ping:update:${updateId}`;
}

export function toRuntimeCommandType(command: BridgeCommand): string {
  if (command.type === "action") {
    return `action:${command.name}`;
  }
  return command.type;
}

function encodeReason(reason: string): string {
  return (
    reason
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_:-]+/g, "_")
      .slice(0, 80) || "unknown"
  );
}

export async function sendActionResult(
  sendTelegramFn: (botToken: string, chatId: number, text: string) => Promise<void>,
  botToken: string,
  chatId: number,
  options: {
    name: string;
    status: ActionResultStatus;
    reason: string;
    sessionId?: string;
  }
): Promise<void> {
  const sessionPart = options.sessionId ? ` session=${options.sessionId}` : "";
  await sendTelegramFn(
    botToken,
    chatId,
    `#faye_action_result name=${options.name} status=${options.status} reason=${encodeReason(options.reason)}${sessionPart}`
  );
}

export function toChatId(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}
