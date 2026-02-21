import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { LEGACY_CONFIG_PATH, LOCAL_EVENT_TOKEN_PATH, RUNTIME_CONFIG_PATH } from "./paths";
import type { ConfigStore } from "./store";
import { expandHomePath, fileMode, pathExists } from "./utils";

export type DoctorErrorCode =
  | "E_DEP_NODE_MISSING"
  | "E_DEP_NPM_MISSING"
  | "E_DEP_PYTHON3_MISSING"
  | "E_DEP_CURL_MISSING"
  | "E_DEP_REC_MISSING"
  | "E_RUNTIME_CONFIG_MISSING"
  | "E_LEGACY_CONFIG_MISSING"
  | "E_LOCAL_EVENT_TOKEN_MISSING"
  | "E_ACTIVE_API_KEY_MISSING"
  | "E_LOCAL_EVENT_TOKEN_MODE_INVALID"
  | "E_ACTIVE_API_KEY_MODE_INVALID";

export interface DoctorReport {
  ok: boolean;
  timestamp: string;
  commands: Record<string, boolean>;
  files: {
    runtimeConfig: boolean;
    legacyConfig: boolean;
    localEventToken: boolean;
    activeApiKey: boolean;
  };
  secretPermissions: {
    localEventTokenMode: string;
    activeApiKeyMode: string;
  };
  statusCodes: {
    commands: {
      node: DoctorErrorCode | null;
      npm: DoctorErrorCode | null;
      python3: DoctorErrorCode | null;
      curl: DoctorErrorCode | null;
      rec: DoctorErrorCode | null;
    };
    files: {
      runtimeConfig: DoctorErrorCode | null;
      legacyConfig: DoctorErrorCode | null;
      localEventToken: DoctorErrorCode | null;
      activeApiKey: DoctorErrorCode | null;
    };
    secretPermissions: {
      localEventTokenMode: DoctorErrorCode | null;
      activeApiKeyMode: DoctorErrorCode | null;
    };
  };
  errorCodes: DoctorErrorCode[];
  profileCount: number;
  activeProfileId: string;
}

interface DoctorDeps {
  hasCommandFn?: (command: string) => boolean;
  pathExistsFn?: (filePath: string) => Promise<boolean>;
  fileModeFn?: (filePath: string) => Promise<number | null>;
}

function defaultHasCommand(command: string): boolean {
  const result = spawnSync("/usr/bin/env", ["bash", "-lc", `command -v ${command}`], {
    stdio: "ignore"
  });
  if (result.status === 0) {
    return true;
  }

  const fallbackDirs = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  return fallbackDirs.some((dir) => fs.existsSync(`${dir}/${command}`));
}

function modeToOctal(mode: number | null): string {
  if (mode === null) {
    return "missing";
  }
  return `0${mode.toString(8)}`;
}

export async function runDoctor(store: ConfigStore, deps: DoctorDeps = {}): Promise<DoctorReport> {
  const hasCommandFn = deps.hasCommandFn ?? defaultHasCommand;
  const pathExistsFn = deps.pathExistsFn ?? pathExists;
  const fileModeFn = deps.fileModeFn ?? fileMode;

  const config = store.getConfig();
  const active = store.getActiveProfile();
  const activeApiKeyPath = expandHomePath(active.elevenLabsApiKeyPath);

  const runtimeExists = await pathExistsFn(RUNTIME_CONFIG_PATH);
  const legacyExists = await pathExistsFn(LEGACY_CONFIG_PATH);
  const tokenExists = await pathExistsFn(LOCAL_EVENT_TOKEN_PATH);
  const apiKeyExists = await pathExistsFn(activeApiKeyPath);

  const localTokenMode = modeToOctal(await fileModeFn(LOCAL_EVENT_TOKEN_PATH));
  const apiKeyMode = modeToOctal(await fileModeFn(activeApiKeyPath));

  const commands = {
    node: hasCommandFn("node"),
    npm: hasCommandFn("npm"),
    python3: hasCommandFn("python3"),
    curl: hasCommandFn("curl"),
    rec: hasCommandFn("rec")
  };

  const statusCodes: DoctorReport["statusCodes"] = {
    commands: {
      node: commands.node ? null : "E_DEP_NODE_MISSING",
      npm: commands.npm ? null : "E_DEP_NPM_MISSING",
      python3: commands.python3 ? null : "E_DEP_PYTHON3_MISSING",
      curl: commands.curl ? null : "E_DEP_CURL_MISSING",
      rec: commands.rec ? null : "E_DEP_REC_MISSING"
    },
    files: {
      runtimeConfig: runtimeExists ? null : "E_RUNTIME_CONFIG_MISSING",
      legacyConfig: legacyExists ? null : "E_LEGACY_CONFIG_MISSING",
      localEventToken: tokenExists ? null : "E_LOCAL_EVENT_TOKEN_MISSING",
      activeApiKey: apiKeyExists ? null : "E_ACTIVE_API_KEY_MISSING"
    },
    secretPermissions: {
      localEventTokenMode: localTokenMode === "0600" ? null : "E_LOCAL_EVENT_TOKEN_MODE_INVALID",
      activeApiKeyMode: apiKeyMode === "0600" ? null : "E_ACTIVE_API_KEY_MODE_INVALID"
    }
  };

  const errorCodes = new Set<DoctorErrorCode>();
  for (const code of Object.values(statusCodes.commands)) {
    if (code) {
      errorCodes.add(code);
    }
  }
  for (const code of Object.values(statusCodes.files)) {
    if (code) {
      errorCodes.add(code);
    }
  }

  if (tokenExists && statusCodes.secretPermissions.localEventTokenMode) {
    errorCodes.add(statusCodes.secretPermissions.localEventTokenMode);
  }
  if (apiKeyExists && statusCodes.secretPermissions.activeApiKeyMode) {
    errorCodes.add(statusCodes.secretPermissions.activeApiKeyMode);
  }

  const ok =
    Object.values(commands).every(Boolean) &&
    runtimeExists &&
    legacyExists &&
    tokenExists &&
    localTokenMode === "0600" &&
    apiKeyExists &&
    apiKeyMode === "0600";

  return {
    ok,
    timestamp: new Date().toISOString(),
    commands,
    files: {
      runtimeConfig: runtimeExists,
      legacyConfig: legacyExists,
      localEventToken: tokenExists,
      activeApiKey: apiKeyExists
    },
    secretPermissions: {
      localEventTokenMode: localTokenMode,
      activeApiKeyMode: apiKeyMode
    },
    statusCodes,
    errorCodes: [...errorCodes],
    profileCount: config.profiles.length,
    activeProfileId: config.activeProfileId
  };
}
