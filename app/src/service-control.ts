import { spawn } from "node:child_process";
import path from "node:path";

import type { Logger } from "./logger";
import { REPO_ROOT } from "./paths";

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runShell(scriptPath: string, args: string[]): Promise<CommandResult> {
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
}

export class ServiceControl {
  private readonly listenerScript = path.join(REPO_ROOT, "scripts", "listener-control.sh");
  private readonly dashboardScript = path.join(REPO_ROOT, "scripts", "dashboard-control.sh");
  private readonly bridgeScript = path.join(REPO_ROOT, "scripts", "telegram-bridge-control.sh");

  constructor(private readonly logger: Logger) {}

  async restartListener(): Promise<CommandResult> {
    const result = await runShell(this.listenerScript, ["restart"]);
    if (result.code !== 0) {
      this.logger.warn("LISTENER_RESTART_FAILED", "Listener restart failed", result);
    }
    return result;
  }

  async restartDashboard(): Promise<CommandResult> {
    const result = await runShell(this.dashboardScript, ["restart"]);
    if (result.code !== 0) {
      this.logger.warn("DASHBOARD_RESTART_FAILED", "Dashboard restart failed", result);
    }
    return result;
  }

  async restartBridge(): Promise<CommandResult> {
    const result = await runShell(this.bridgeScript, ["restart"]);
    if (result.code !== 0) {
      this.logger.warn("BRIDGE_RESTART_FAILED", "Telegram bridge restart failed", result);
    }
    return result;
  }

  async listenerStatus(): Promise<CommandResult> {
    return runShell(this.listenerScript, ["status"]);
  }

  async dashboardStatus(): Promise<CommandResult> {
    return runShell(this.dashboardScript, ["status"]);
  }

  async bridgeStatus(): Promise<CommandResult> {
    return runShell(this.bridgeScript, ["status"]);
  }
}
