import { spawn } from "node:child_process";
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
  REPO_ROOT,
  RUNTIME_CONFIG_PATH
} from "./paths";
import {
  parseRequiredCommandsFromEnv,
  parseWritablePathsFromEnv,
  runPreflight,
  type PreflightReport
} from "./preflight";
import { ServiceControl } from "./service-control";
import { ConfigStore } from "./store";
import type { InstallAttemptReport, ProfileCreateInput } from "./types";
import { pathExists, writeInstallAttemptReport, writeSecret } from "./utils";

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | true>;
}

interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

const DASHBOARD_URL = "http://127.0.0.1:4587";
const PANIC_STOP_CONFIRMATION = "PANIC STOP";
const FACTORY_RESET_CONFIRMATION = "FACTORY RESET";

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

function hasFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.has(name);
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

async function spawnCommand(command: string, args: string[], options?: { cwd?: string; stdio?: "ignore" | "pipe" }): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      stdio: ["ignore", options?.stdio ?? "pipe", options?.stdio ?? "pipe"]
    });

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", (error) => {
      resolve({
        code: 1,
        stdout,
        stderr: error.message
      });
    });

    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}

async function openDashboard(url: string): Promise<{ opened: boolean; method: string }> {
  if (process.platform === "darwin") {
    const result = await spawnCommand("open", [url], { stdio: "ignore" });
    return { opened: result.code === 0, method: "open" };
  }

  if (process.platform === "linux") {
    const result = await spawnCommand("xdg-open", [url], { stdio: "ignore" });
    return { opened: result.code === 0, method: "xdg-open" };
  }

  return { opened: false, method: "manual" };
}

async function ensureSetup(store: ConfigStore, args: ParsedArgs): Promise<void> {
  const nonInteractive = hasFlag(args, "non-interactive");

  const profileName =
    getFlag(args, "profile-name") ?? (nonInteractive ? "Primary Voice" : await prompt("Profile name [Primary Voice]: ", "Primary Voice"));
  const voiceId = getFlag(args, "voice-id") ?? (nonInteractive ? "" : await prompt("ElevenLabs voice ID: "));
  const voiceName = getFlag(args, "voice-name") ?? (nonInteractive ? "" : await prompt("Voice display name: "));
  const wakeWord = getFlag(args, "wake-word") ?? (nonInteractive ? "Faye Arise" : await prompt("Wake word [Faye Arise]: ", "Faye Arise"));

  const apiKey = getFlag(args, "api-key");
  const telegramToken = getFlag(args, "telegram-bot-token");
  const telegramChatId = getFlag(args, "telegram-chat-id");

  if (nonInteractive) {
    const missing: string[] = [];
    if (!voiceId) {
      missing.push("--voice-id");
    }
    if (!voiceName) {
      missing.push("--voice-name");
    }

    if (!(await pathExists(DEFAULT_ELEVENLABS_KEY_PATH)) && !(apiKey && apiKey.trim().length > 0)) {
      missing.push("--api-key");
    }

    if (missing.length > 0) {
      throw new Error(`E_SETUP_NON_INTERACTIVE_MISSING_FIELDS:${missing.join(",")}`);
    }
  }

  if (!voiceId || !voiceName) {
    throw new Error("E_SETUP_MISSING_VOICE_FIELDS");
  }

  if (apiKey && apiKey.trim()) {
    await writeSecret(DEFAULT_ELEVENLABS_KEY_PATH, apiKey);
  } else if (!(await pathExists(DEFAULT_ELEVENLABS_KEY_PATH))) {
    if (nonInteractive) {
      throw new Error("E_SETUP_MISSING_API_KEY");
    }

    const keyFromPrompt = await prompt("ElevenLabs API key: ");
    if (!keyFromPrompt) {
      throw new Error("E_SETUP_MISSING_API_KEY");
    }
    await writeSecret(DEFAULT_ELEVENLABS_KEY_PATH, keyFromPrompt);
  }

  if (telegramToken && telegramToken.trim()) {
    await writeSecret(DEFAULT_TELEGRAM_TOKEN_PATH, telegramToken);
  }

  const eventTransportRaw = getFlag(args, "event-transport") ?? "hybrid";
  if (eventTransportRaw !== "local" && eventTransportRaw !== "hybrid") {
    throw new Error("E_SETUP_INVALID_EVENT_TRANSPORT");
  }

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
  await store.setEventTransport(eventTransportRaw);

  const logger = createLogger();
  logger.info("SETUP_DONE", "Faye setup complete", {
    profileId: profile.id,
    runtimeConfig: RUNTIME_CONFIG_PATH,
    legacyConfig: LEGACY_CONFIG_PATH,
    nonInteractive
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

async function synthesizeAndPlay(store: ConfigStore, text: string, profileId?: string): Promise<void> {
  const config = store.getConfig();
  const selectedProfileId = profileId ?? config.activeProfileId;
  const profile = config.profiles.find((item) => item.id === selectedProfileId);
  if (!profile) {
    throw new Error("E_PROFILE_NOT_FOUND");
  }

  const elevenLabs = new ElevenLabsClient(createLogger());
  const outFile = path.join(os.tmpdir(), `faye-cli-speak-${Date.now()}.mp3`);
  await elevenLabs.synthesizeToFile(profile, text, outFile);
  await playAudioFile(outFile);
  await fs.unlink(outFile).catch(() => undefined);
}

async function speakCommand(store: ConfigStore, args: ParsedArgs): Promise<void> {
  const text = (getFlag(args, "text") ?? args.positionals.slice(1).join(" ")) || "Faye voice test successful.";
  await synthesizeAndPlay(store, text, getFlag(args, "profile-id"));
}

async function doctorCommand(store: ConfigStore): Promise<void> {
  const report = await runDoctor(store);
  console.log(JSON.stringify(report, null, 2));
}

async function statusCommand(store: ConfigStore, args: ParsedArgs): Promise<void> {
  const doctor = await runDoctor(store);
  const services = new ServiceControl(createLogger());
  const listener = await services.listenerStatus();
  const dashboard = await services.dashboardStatus();
  const bridge = await services.bridgeStatus();
  const activeProfile = store.getActiveProfile();
  const bridgeRequired = Boolean(activeProfile.telegramBotTokenPath && activeProfile.telegramChatId);
  const servicesOk = listener.code === 0 && dashboard.code === 0 && (!bridgeRequired || bridge.code === 0);
  const ok = doctor.ok && servicesOk;

  const payload = {
    ok,
    doctor,
    services: {
      listener,
      dashboard,
      bridge,
      bridgeRequired,
      servicesOk
    }
  };

  if (hasFlag(args, "json")) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`Status: ${ok ? "PASS" : "ATTENTION"}`);
  console.log(`Dashboard: ${DASHBOARD_URL}`);
  console.log(`Doctor: ${doctor.ok ? "ok" : "not ok"}`);
  console.log(`Listener: ${listener.code === 0 ? "running" : "stopped"}`);
  console.log(`Dashboard service: ${dashboard.code === 0 ? "running" : "stopped"}`);
  console.log(`Bridge: ${bridge.code === 0 ? "running" : bridgeRequired ? "required but stopped" : "optional/off"}`);
}

async function openCommand(args: ParsedArgs): Promise<void> {
  if (hasFlag(args, "print")) {
    console.log(DASHBOARD_URL);
    return;
  }

  const opened = await openDashboard(DASHBOARD_URL);
  if (hasFlag(args, "json")) {
    console.log(
      JSON.stringify(
        {
          url: DASHBOARD_URL,
          opened: opened.opened,
          method: opened.method
        },
        null,
        2
      )
    );
    return;
  }

  if (opened.opened) {
    console.log(`Opened dashboard: ${DASHBOARD_URL}`);
  } else {
    console.log(`Open dashboard manually: ${DASHBOARD_URL}`);
  }
}

async function runRecoveryScript(mode: "panic-stop" | "factory-reset", args: ParsedArgs): Promise<void> {
  const confirmation = getFlag(args, "confirm") ?? (hasFlag(args, "yes") ? (mode === "panic-stop" ? PANIC_STOP_CONFIRMATION : FACTORY_RESET_CONFIRMATION) : "");
  if (!confirmation) {
    throw new Error(mode === "panic-stop" ? "E_PANIC_CONFIRMATION_REQUIRED" : "E_FACTORY_RESET_CONFIRMATION_REQUIRED");
  }

  const scriptPath = path.join(REPO_ROOT, "scripts", "panic-reset.sh");
  const scriptArgs = [scriptPath, mode, "--confirm", confirmation, "--reason", getFlag(args, "reason") ?? (mode === "panic-stop" ? "cli_panic_stop" : "cli_factory_reset"), "--json"];
  const result = await spawnCommand("/usr/bin/env", ["bash", ...scriptArgs], { cwd: REPO_ROOT });

  if (result.code !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || "E_SYSTEM_RECOVERY_FAILED";
    throw new Error(message);
  }

  const parsed = JSON.parse(result.stdout || "{}") as { ok?: boolean; result?: unknown };
  if (hasFlag(args, "json")) {
    console.log(JSON.stringify(parsed, null, 2));
    return;
  }

  const outcome = parsed.ok === true ? "completed" : "completed with warnings";
  console.log(`${mode === "panic-stop" ? "Panic stop" : "Factory reset"} ${outcome}.`);
  console.log(`Dashboard URL: ${DASHBOARD_URL}`);
}

function printPreflightReport(report: PreflightReport): void {
  console.log(`Preflight status: ${report.ok ? "PASS" : "FAIL"}`);
  console.log(`Timestamp: ${report.timestamp}`);

  console.log("\nDependencies:");
  for (const [name, ok] of Object.entries(report.requiredCommands)) {
    console.log(`- ${name}: ${ok ? "ok" : "missing"}`);
  }

  console.log("\nWritable paths:");
  for (const [dirPath, ok] of Object.entries(report.writablePaths)) {
    console.log(`- ${dirPath}: ${ok ? "ok" : "not writable"}`);
  }

  console.log("\nMicrophone tooling:");
  console.log(`- command=${report.microphone.command} available=${report.microphone.available ? "yes" : "no"}`);

  if (report.errorCodes.length > 0) {
    console.log("\nError codes:");
    for (const code of report.errorCodes) {
      console.log(`- ${code}`);
    }
  }
}

async function preflightCommand(args: ParsedArgs): Promise<void> {
  const report = await runPreflight({
    requiredCommands: parseRequiredCommandsFromEnv(process.env.FAYE_PREFLIGHT_REQUIRED_COMMANDS),
    writablePaths: parseWritablePathsFromEnv(process.env.FAYE_PREFLIGHT_WRITABLE_PATHS),
    microphoneCommand: process.env.FAYE_PREFLIGHT_MIC_COMMAND
  });

  if (hasFlag(args, "json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printPreflightReport(report);
  }

  if (!report.ok) {
    throw new Error("E_PREFLIGHT_FAILED");
  }
}

async function firstSuccessCommand(store: ConfigStore, args: ParsedArgs): Promise<void> {
  const startedAt = Date.now();
  const logger = createLogger();
  const services = new ServiceControl(logger);

  const doctorReport = await runDoctor(store);
  const listener = await services.listenerStatus();
  const dashboard = await services.dashboardStatus();
  const bridge = await services.bridgeStatus();

  const activeProfile = store.getActiveProfile();
  const bridgeRequired = Boolean(activeProfile.telegramBotTokenPath && activeProfile.telegramChatId);
  const servicesOk = listener.code === 0 && dashboard.code === 0 && (!bridgeRequired || bridge.code === 0);

  const skipSpeak = hasFlag(args, "skip-speak");
  let firstSpeakOk: boolean | null = null;
  let speakMessage = "skipped";

  if (!skipSpeak) {
    try {
      const probeText = getFlag(args, "text") ?? "Faye first-success probe."
      await synthesizeAndPlay(store, probeText, getFlag(args, "profile-id"));
      firstSpeakOk = true;
      speakMessage = "ok";
    } catch (error) {
      firstSpeakOk = false;
      speakMessage = error instanceof Error ? error.message : String(error);
    }
  }

  const steps: InstallAttemptReport["steps"] = [
    {
      name: "doctor",
      ok: doctorReport.ok,
      code: doctorReport.ok ? "OK" : doctorReport.errorCodes[0] ?? "E_DOCTOR_FAILED",
      message: doctorReport.ok ? "doctor checks passed" : doctorReport.errorCodes.join(", ")
    },
    {
      name: "listener-status",
      ok: listener.code === 0,
      code: listener.code === 0 ? "OK" : "E_LISTENER_STATUS",
      message: (listener.stderr || listener.stdout || "listener status failed").trim().slice(0, 280)
    },
    {
      name: "dashboard-status",
      ok: dashboard.code === 0,
      code: dashboard.code === 0 ? "OK" : "E_DASHBOARD_STATUS",
      message: (dashboard.stderr || dashboard.stdout || "dashboard status failed").trim().slice(0, 280)
    },
    {
      name: "bridge-status",
      ok: bridgeRequired ? bridge.code === 0 : true,
      code: bridgeRequired ? (bridge.code === 0 ? "OK" : "E_BRIDGE_STATUS") : "SKIPPED_OPTIONAL",
      message: bridgeRequired
        ? (bridge.stderr || bridge.stdout || "bridge status failed").trim().slice(0, 280)
        : "bridge optional (telegram not configured)"
    },
    {
      name: "speak-probe",
      ok: firstSpeakOk !== false,
      code: firstSpeakOk === null ? "SKIPPED" : firstSpeakOk ? "OK" : "E_SPEAK_PROBE_FAILED",
      message: speakMessage
    }
  ];

  const success = doctorReport.ok && servicesOk && firstSpeakOk !== false;
  const report: InstallAttemptReport = {
    schemaVersion: 1,
    attemptId: `first-success-${Date.now()}-${process.pid}`,
    generatedAt: new Date().toISOString(),
    source: "faye-first-success",
    success,
    durationMs: Math.max(0, Date.now() - startedAt),
    platform: `${process.platform}-${process.arch}`,
    nodeVersion: process.versions.node,
    doctorOk: doctorReport.ok,
    servicesOk,
    firstSpeakOk,
    steps,
    notes: [
      `bridgeRequired=${bridgeRequired ? "true" : "false"}`,
      `skipSpeak=${skipSpeak ? "true" : "false"}`
    ]
  };

  const reportPath = await writeInstallAttemptReport(report, { prefix: "install-attempt" });

  const payload = {
    ok: success,
    reportPath,
    doctor: doctorReport,
    services: {
      listener,
      dashboard,
      bridge,
      bridgeRequired,
      servicesOk
    },
    speakProbe: {
      ok: firstSpeakOk,
      message: speakMessage
    }
  };

  if (hasFlag(args, "json")) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`First-success: ${success ? "PASS" : "FAIL"}`);
    console.log(`Report: ${reportPath}`);
    console.log(`Doctor ok: ${doctorReport.ok}`);
    console.log(`Services ok: ${servicesOk}`);
    console.log(`Speak probe: ${firstSpeakOk === null ? "skipped" : firstSpeakOk ? "ok" : "failed"}`);
  }

  if (!success) {
    throw new Error("E_FIRST_SUCCESS_FAILED");
  }
}

function printHelp(): void {
  console.log(`
Faye CLI

Commands:
  open [--print] [--json]
  status [--json]
  panic --confirm "PANIC STOP" [--reason ...] [--json]
  reset --confirm "FACTORY RESET" [--reason ...] [--json]
  preflight [--json]
  setup [--non-interactive --api-key ... --voice-id ... --voice-name ... --wake-word ...]
  profile list
  profile create --name ... --voice-id ... --voice-name ... [--wake-word ...]
  profile update --id ... [--wake-word ...]
  profile activate --id ...
  profile delete --id ...
  speak --text "hello"
  doctor
  first-success [--json] [--skip-speak] [--text "probe text"]
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positionals[0] ?? "help";

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "preflight") {
    await preflightCommand(args);
    return;
  }

  if (command === "open") {
    await openCommand(args);
    return;
  }

  if (command === "panic") {
    await runRecoveryScript("panic-stop", args);
    return;
  }

  if (command === "reset") {
    await runRecoveryScript("factory-reset", args);
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

  if (command === "status") {
    await statusCommand(store, args);
    return;
  }

  if (command === "speak") {
    await speakCommand(store, args);
    return;
  }

  if (command === "first-success") {
    await firstSuccessCommand(store, args);
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
