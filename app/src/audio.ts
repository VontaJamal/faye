import { spawn, spawnSync } from "node:child_process";

function hasCommand(command: string): boolean {
  const probe = spawnSync("/usr/bin/env", ["bash", "-lc", `command -v ${command}`], {
    stdio: "ignore"
  });
  return probe.status === 0;
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `Audio command failed with code ${String(code)}`));
      }
    });
  });
}

export async function playAudioFile(filePath: string): Promise<void> {
  if (hasCommand("afplay")) {
    await runCommand("afplay", [filePath]);
    return;
  }

  if (hasCommand("mpv")) {
    await runCommand("mpv", ["--no-video", "--really-quiet", filePath]);
    return;
  }

  if (hasCommand("ffplay")) {
    await runCommand("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", filePath]);
    return;
  }

  throw new Error("E_AUDIO_PLAYER_NOT_FOUND");
}
