import { spawnSync } from "node:child_process";
import { fileMode, pathExists } from "./utils";
import { LEGACY_CONFIG_PATH, LOCAL_EVENT_TOKEN_PATH, RUNTIME_CONFIG_PATH } from "./paths";
import type { ConfigStore } from "./store";

export interface DoctorReport {
  ok: boolean;
  timestamp: string;
  commands: Record<string, boolean>;
  files: {
    runtimeConfig: boolean;
    legacyConfig: boolean;
    localEventToken: boolean;
  };
  secretPermissions: {
    localEventTokenMode: string;
    activeApiKeyMode: string;
  };
  profileCount: number;
  activeProfileId: string;
}

function hasCommand(command: string): boolean {
  const result = spawnSync("/usr/bin/env", ["bash", "-lc", `command -v ${command}`], {
    stdio: "ignore"
  });
  return result.status === 0;
}

function modeToOctal(mode: number | null): string {
  if (mode === null) {
    return "missing";
  }
  return `0${mode.toString(8)}`;
}

export async function runDoctor(store: ConfigStore): Promise<DoctorReport> {
  const config = store.getConfig();
  const active = store.getActiveProfile();

  const runtimeExists = await pathExists(RUNTIME_CONFIG_PATH);
  const legacyExists = await pathExists(LEGACY_CONFIG_PATH);
  const tokenExists = await pathExists(LOCAL_EVENT_TOKEN_PATH);

  const localTokenMode = modeToOctal(await fileMode(LOCAL_EVENT_TOKEN_PATH));
  const apiKeyMode = modeToOctal(await fileMode(active.elevenLabsApiKeyPath.replace(/^~\//, `${process.env.HOME ?? ""}/`)));

  const commands = {
    node: hasCommand("node"),
    npm: hasCommand("npm"),
    python3: hasCommand("python3"),
    curl: hasCommand("curl"),
    rec: hasCommand("rec")
  };

  const ok =
    Object.values(commands).every(Boolean) &&
    runtimeExists &&
    legacyExists &&
    tokenExists &&
    localTokenMode === "0600";

  return {
    ok,
    timestamp: new Date().toISOString(),
    commands,
    files: {
      runtimeConfig: runtimeExists,
      legacyConfig: legacyExists,
      localEventToken: tokenExists
    },
    secretPermissions: {
      localEventTokenMode: localTokenMode,
      activeApiKeyMode: apiKeyMode
    },
    profileCount: config.profiles.length,
    activeProfileId: config.activeProfileId
  };
}
