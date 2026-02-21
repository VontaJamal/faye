import { spawn, spawnSync } from "node:child_process";

export interface AudioPlayerDeps {
  hasCommandFn: (command: string) => boolean;
  runCommandFn: (command: string, args: string[]) => Promise<void>;
}

const defaultHasCommand = (command: string): boolean => {
  const probe = spawnSync("/usr/bin/env", ["bash", "-lc", `command -v ${command}`], {
    stdio: "ignore"
  });
  return probe.status === 0;
};

const defaultRunCommand = async (command: string, args: string[]): Promise<void> => {
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
};

export function createAudioPlayer(partialDeps: Partial<AudioPlayerDeps> = {}): (filePath: string) => Promise<void> {
  const deps: AudioPlayerDeps = {
    hasCommandFn: partialDeps.hasCommandFn ?? defaultHasCommand,
    runCommandFn: partialDeps.runCommandFn ?? defaultRunCommand
  };

  return async (filePath: string): Promise<void> => {
    if (deps.hasCommandFn("afplay")) {
      await deps.runCommandFn("afplay", [filePath]);
      return;
    }

    if (deps.hasCommandFn("mpv")) {
      await deps.runCommandFn("mpv", ["--no-video", "--really-quiet", filePath]);
      return;
    }

    if (deps.hasCommandFn("ffplay")) {
      await deps.runCommandFn("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", filePath]);
      return;
    }

    throw new Error("E_AUDIO_PLAYER_NOT_FOUND");
  };
}

export async function playAudioFile(filePath: string): Promise<void> {
  const player = createAudioPlayer();
  await player(filePath);
}
