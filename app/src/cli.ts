import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { playAudioFile } from "./audio";
import { runDoctor } from "./doctor";
import { ElevenLabsClient } from "./elevenlabs";
import { createLogger } from "./logger";
import {
  DEFAULT_ELEVENLABS_KEY_PATH,
  DEFAULT_TELEGRAM_TOKEN_PATH,
  LEGACY_CONFIG_PATH,
  RUNTIME_CONFIG_PATH
} from "./paths";
import { ServiceControl } from "./service-control";
import { ConfigStore } from "./store";
import type { ProfileCreateInput } from "./types";
import { pathExists, writeSecret } from "./utils";

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (!token) {
      continue;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }

    flags.set(key, next);
    i += 1;
  }

  return { positionals, flags };
}

function getFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

async function prompt(question: string, fallback?: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  const answer = (await rl.question(question)).trim();
  rl.close();
  if (answer.length === 0 && fallback) {
    return fallback;
  }
  return answer;
}

async function ensureSetup(store: ConfigStore, args: ParsedArgs): Promise<void> {
  const profileName = getFlag(args, "profile-name") ?? (await prompt("Profile name [Primary Voice]: ", "Primary Voice"));
  const voiceId = getFlag(args, "voice-id") ?? (await prompt("ElevenLabs voice ID: "));
  const voiceName = getFlag(args, "voice-name") ?? (await prompt("Voice display name: "));
  const wakeWord = getFlag(args, "wake-word") ?? (await prompt("Wake word [Faye Arise]: ", "Faye Arise"));

  if (!voiceId || !voiceName) {
    throw new Error("E_SETUP_MISSING_VOICE_FIELDS");
  }

  const apiKey = getFlag(args, "api-key");
  if (apiKey && apiKey.trim()) {
    await writeSecret(DEFAULT_ELEVENLABS_KEY_PATH, apiKey);
  } else if (!(await pathExists(DEFAULT_ELEVENLABS_KEY_PATH))) {
    const keyFromPrompt = await prompt("ElevenLabs API key: ");
    if (!keyFromPrompt) {
      throw new Error("E_SETUP_MISSING_API_KEY");
    }
    await writeSecret(DEFAULT_ELEVENLABS_KEY_PATH, keyFromPrompt);
  }

  const telegramToken = getFlag(args, "telegram-bot-token");
  const telegramChatId = getFlag(args, "telegram-chat-id");
  if (telegramToken && telegramToken.trim()) {
    await writeSecret(DEFAULT_TELEGRAM_TOKEN_PATH, telegramToken);
  }

  const eventTransport = (getFlag(args, "event-transport") ?? "hybrid") as "local" | "hybrid";

  const profileInput: ProfileCreateInput = {
    name: profileName,
    voiceId,
    voiceName,
    wakeWord,
    model: "eleven_multilingual_v2",
    stability: 0.4,
    similarityBoost: 0.8,
    style: 0.7,
    elevenLabsApiKeyPath: DEFAULT_ELEVENLABS_KEY_PATH,
    telegramBotTokenPath: telegramToken ? DEFAULT_TELEGRAM_TOKEN_PATH : undefined,
    telegramChatId,
    silenceThreshold: "0.5%",
    wakeWordVariants: [wakeWord.toLowerCase()]
  };

  const profile = await store.upsertSetupProfile(profileInput);
  await store.activateProfile(profile.id);
  await store.setEventTransport(eventTransport);

  const logger = createLogger();
  logger.info("SETUP_DONE", "Faye setup complete", {
    profileId: profile.id,
    runtimeConfig: RUNTIME_CONFIG_PATH,
    legacyConfig: LEGACY_CONFIG_PATH
  });

  console.log(`Configured profile '${profile.name}' (${profile.id})`);
}

function printProfiles(store: ConfigStore): void {
  const config = store.getConfig();
  const rows = config.profiles.map((profile) => {
    const marker = profile.id === config.activeProfileId ? "*" : " ";
    return `${marker} ${profile.id.padEnd(20)} ${profile.name.padEnd(18)} wake='${profile.wakeWord}' voice='${profile.voiceName}'`;
  });
  console.log(rows.join("\n"));
}

async function profileCommand(store: ConfigStore, args: ParsedArgs): Promise<void> {
  const action = args.positionals[2] ?? "list";

  if (action === "list") {
    printProfiles(store);
    return;
  }

  if (action === "create") {
    const name = getFlag(args, "name");
    const voiceId = getFlag(args, "voice-id");
    const voiceName = getFlag(args, "voice-name");
    const wakeWord = getFlag(args, "wake-word") ?? "Faye Arise";

    if (!name || !voiceId || !voiceName) {
      throw new Error("E_PROFILE_CREATE_REQUIRED_FIELDS");
    }

    const profile = await store.createProfile({
      name,
      voiceId,
      voiceName,
      wakeWord,
      wakeWordVariants: [wakeWord.toLowerCase()],
      model: "eleven_multilingual_v2",
      stability: Number(getFlag(args, "stability") ?? "0.4"),
      similarityBoost: Number(getFlag(args, "similarity-boost") ?? "0.8"),
      style: Number(getFlag(args, "style") ?? "0.7"),
      elevenLabsApiKeyPath: getFlag(args, "api-key-path") ?? DEFAULT_ELEVENLABS_KEY_PATH,
      telegramBotTokenPath: getFlag(args, "telegram-token-path"),
      telegramChatId: getFlag(args, "telegram-chat-id"),
      silenceThreshold: getFlag(args, "silence-threshold") ?? "0.5%"
    });

    console.log(JSON.stringify({ profile }, null, 2));
    return;
  }

  if (action === "update") {
    const id = getFlag(args, "id");
    if (!id) {
      throw new Error("E_PROFILE_UPDATE_MISSING_ID");
    }

    const patch = {
      name: getFlag(args, "name"),
      voiceId: getFlag(args, "voice-id"),
      voiceName: getFlag(args, "voice-name"),
      wakeWord: getFlag(args, "wake-word"),
      wakeWordVariants: getFlag(args, "wake-word") ? [String(getFlag(args, "wake-word")).toLowerCase()] : undefined,
      stability: getFlag(args, "stability") ? Number(getFlag(args, "stability")) : undefined,
      similarityBoost: getFlag(args, "similarity-boost") ? Number(getFlag(args, "similarity-boost")) : undefined,
      style: getFlag(args, "style") ? Number(getFlag(args, "style")) : undefined,
      silenceThreshold: getFlag(args, "silence-threshold"),
      telegramChatId: getFlag(args, "telegram-chat-id")
    };

    const profile = await store.updateProfile(id, patch);
    console.log(JSON.stringify({ profile }, null, 2));
    return;
  }

  if (action === "activate") {
    const id = getFlag(args, "id");
    if (!id) {
      throw new Error("E_PROFILE_ACTIVATE_MISSING_ID");
    }
    const profile = await store.activateProfile(id);
    const services = new ServiceControl(createLogger());
    await services.restartListener();
    console.log(`Activated profile ${profile.name} (${profile.id})`);
    return;
  }

  if (action === "delete") {
    const id = getFlag(args, "id");
    if (!id) {
      throw new Error("E_PROFILE_DELETE_MISSING_ID");
    }

    await store.deleteProfile(id);
    console.log(`Deleted profile ${id}`);
    return;
  }

  throw new Error("E_PROFILE_ACTION_UNKNOWN");
}

async function speakCommand(store: ConfigStore, args: ParsedArgs): Promise<void> {
  const text = (getFlag(args, "text") ?? args.positionals.slice(1).join(" ")) || "Faye voice test successful.";
  const config = store.getConfig();
  const profileId = getFlag(args, "profile-id") ?? config.activeProfileId;
  const profile = config.profiles.find((item) => item.id === profileId);
  if (!profile) {
    throw new Error("E_PROFILE_NOT_FOUND");
  }

  const elevenLabs = new ElevenLabsClient(createLogger());
  const outFile = path.join(os.tmpdir(), `faye-cli-speak-${Date.now()}.mp3`);
  await elevenLabs.synthesizeToFile(profile, text, outFile);
  await playAudioFile(outFile);
  await fs.unlink(outFile).catch(() => undefined);
}

async function doctorCommand(store: ConfigStore): Promise<void> {
  const report = await runDoctor(store);
  console.log(JSON.stringify(report, null, 2));
}

function printHelp(): void {
  console.log(`
Faye CLI

Commands:
  setup [--api-key ... --voice-id ... --voice-name ... --wake-word ...]
  profile list
  profile create --name ... --voice-id ... --voice-name ... [--wake-word ...]
  profile update --id ... [--wake-word ...]
  profile activate --id ...
  profile delete --id ...
  speak --text "hello"
  doctor
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positionals[0] ?? "help";

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const logger = createLogger();
  const store = new ConfigStore(logger);
  await store.init();

  if (command === "setup") {
    await ensureSetup(store, args);
    return;
  }

  if (command === "profile") {
    await profileCommand(store, args);
    return;
  }

  if (command === "doctor") {
    await doctorCommand(store);
    return;
  }

  if (command === "speak") {
    await speakCommand(store, args);
    return;
  }

  throw new Error("E_COMMAND_UNKNOWN");
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  });
}
