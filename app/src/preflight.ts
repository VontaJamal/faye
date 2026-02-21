import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FAYE_STATE_DIR, OPENCLAW_DIR, REPO_ROOT, SECRETS_DIR } from "./paths";

export interface PreflightReport {
  ok: boolean;
  timestamp: string;
  requiredCommands: Record<string, boolean>;
  writablePaths: Record<string, boolean>;
  microphone: {
    command: string;
    available: boolean;
  };
  errorCodes: string[];
}

export interface PreflightOptions {
  requiredCommands?: string[];
  writablePaths?: string[];
  microphoneCommand?: string;
}

function hasCommand(command: string): boolean {
  const result = spawnSync("/usr/bin/env", ["bash", "-lc", `command -v ${command}`], {
    stdio: "ignore"
  });
  return result.status === 0;
}

async function isWritable(dirPath: string): Promise<boolean> {
  try {
    await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
    const probePath = path.join(dirPath, `.faye-write-probe-${process.pid}-${Date.now()}`);
    await fs.writeFile(probePath, "ok\n", { mode: 0o600 });
    await fs.unlink(probePath);
    return true;
  } catch {
    return false;
  }
}

export async function runPreflight(options: PreflightOptions = {}): Promise<PreflightReport> {
  const requiredCommands = options.requiredCommands ?? ["node", "npm", "python3", "curl", "rec"];
  const writablePaths =
    options.writablePaths ?? [OPENCLAW_DIR, SECRETS_DIR, FAYE_STATE_DIR, path.join(REPO_ROOT, ".faye", "reports")];
  const microphoneCommand = options.microphoneCommand ?? "rec";

  const commandChecks: Record<string, boolean> = {};
  for (const command of requiredCommands) {
    commandChecks[command] = hasCommand(command);
  }

  const pathChecks: Record<string, boolean> = {};
  for (const dirPath of writablePaths) {
    pathChecks[dirPath] = await isWritable(dirPath);
  }

  const microphoneAvailable = hasCommand(microphoneCommand);

  const errorCodes: string[] = [];
  for (const [command, ok] of Object.entries(commandChecks)) {
    if (!ok) {
      errorCodes.push(`E_PREFLIGHT_DEP_${command.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_MISSING`);
    }
  }

  for (const [dirPath, ok] of Object.entries(pathChecks)) {
    if (!ok) {
      errorCodes.push(`E_PREFLIGHT_PATH_NOT_WRITABLE:${dirPath}`);
    }
  }

  if (!microphoneAvailable) {
    errorCodes.push("E_PREFLIGHT_MIC_TOOLING_UNAVAILABLE");
  }

  return {
    ok: errorCodes.length === 0,
    timestamp: new Date().toISOString(),
    requiredCommands: commandChecks,
    writablePaths: pathChecks,
    microphone: {
      command: microphoneCommand,
      available: microphoneAvailable
    },
    errorCodes
  };
}

export function parseRequiredCommandsFromEnv(rawValue: string | undefined): string[] | undefined {
  if (!rawValue) {
    return undefined;
  }
  const commands = rawValue
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return commands.length > 0 ? commands : undefined;
}

export function parseWritablePathsFromEnv(rawValue: string | undefined): string[] | undefined {
  if (!rawValue) {
    return undefined;
  }
  const candidates = rawValue
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      if (item === "~") {
        return os.homedir();
      }
      if (item.startsWith("~/")) {
        return path.join(os.homedir(), item.slice(2));
      }
      return item;
    });
  return candidates.length > 0 ? candidates : undefined;
}
