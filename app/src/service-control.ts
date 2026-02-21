import { spawn } from "node:child_process";
import path from "node:path";

import type { Logger } from "./logger";
import { REPO_ROOT } from "./paths";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type RunShellFn = (scriptPath: string, args: string[]) => Promise<CommandResult>;

export interface ServiceControlOptions {
  listenerScript?: string;
  dashboardScript?: string;
  bridgeScript?: string;
  runShellFn?: RunShellFn;
}

export const defaultRunShell: RunShellFn = async (scriptPath, args) => {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/env", ["bash", scriptPath, ...args], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
};

export class ServiceControl {
  private readonly listenerScript: string;
  private readonly dashboardScript: string;
  private readonly bridgeScript: string;
  private readonly runShellFn: RunShellFn;

  constructor(
    private readonly logger: Logger,
    options: ServiceControlOptions = {}
  ) {
    this.listenerScript = options.listenerScript ?? path.join(REPO_ROOT, "scripts", "listener-control.sh");
    this.dashboardScript = options.dashboardScript ?? path.join(REPO_ROOT, "scripts", "dashboard-control.sh");
    this.bridgeScript = options.bridgeScript ?? path.join(REPO_ROOT, "scripts", "telegram-bridge-control.sh");
    this.runShellFn = options.runShellFn ?? defaultRunShell;
  }

  async restartListener(): Promise<CommandResult> {
    const result = await this.runShellFn(this.listenerScript, ["restart"]);
    if (result.code !== 0) {
      this.logger.warn("LISTENER_RESTART_FAILED", "Listener restart failed", result);
    }
    return result;
  }

  async restartDashboard(): Promise<CommandResult> {
    const result = await this.runShellFn(this.dashboardScript, ["restart"]);
    if (result.code !== 0) {
      this.logger.warn("DASHBOARD_RESTART_FAILED", "Dashboard restart failed", result);
    }
    return result;
  }

  async restartBridge(): Promise<CommandResult> {
    const result = await this.runShellFn(this.bridgeScript, ["restart"]);
    if (result.code !== 0) {
      this.logger.warn("BRIDGE_RESTART_FAILED", "Telegram bridge restart failed", result);
    }
    return result;
  }

  async listenerStatus(): Promise<CommandResult> {
    return this.runShellFn(this.listenerScript, ["status"]);
  }

  async dashboardStatus(): Promise<CommandResult> {
    return this.runShellFn(this.dashboardScript, ["status"]);
  }

  async bridgeStatus(): Promise<CommandResult> {
    return this.runShellFn(this.bridgeScript, ["status"]);
  }
}
