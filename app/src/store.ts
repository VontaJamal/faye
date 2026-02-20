import crypto from "node:crypto";
import fs from "node:fs/promises";

import {
  DEFAULT_API_BASE_URL,
  DEFAULT_ELEVENLABS_KEY_PATH,
  LEGACY_CONFIG_PATH,
  LOCAL_EVENT_TOKEN_PATH,
  OPENCLAW_DIR,
  RUNTIME_CONFIG_PATH,
  SECRETS_DIR
} from "./paths";
import type { Logger } from "./logger";
import {
  LegacyConfigSchema,
  normalizeVariants,
  ProfileCreateInputSchema,
  ProfilePatchInputSchema,
  RuntimeConfigSchema,
  type ProfileCreateInput,
  type ProfilePatchInput,
  type RuntimeConfig,
  type VoiceProfile
} from "./types";
import {
  deepClone,
  ensureDir,
  pathExists,
  profileIdFromName,
  readJsonFile,
  writeJsonAtomic,
  writeSecret
} from "./utils";

function starterProfile(nowIso: string): VoiceProfile {
  return {
    id: "starter-profile",
    name: "Starter Profile",
    voiceId: "EXAMPLE_VOICE_ID",
    voiceName: "Starter",
    wakeWord: "Faye Arise",
    wakeWordVariants: ["faye arise"],
    model: "eleven_multilingual_v2",
    stability: 0.4,
    similarityBoost: 0.8,
    style: 0.7,
    elevenLabsApiKeyPath: DEFAULT_ELEVENLABS_KEY_PATH,
    silenceThreshold: "0.5%",
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

export class ConfigStore {
  private config: RuntimeConfig | null = null;
  private localEventToken = "";

  constructor(private readonly logger: Logger) {}

  async init(): Promise<void> {
    await ensureDir(OPENCLAW_DIR);
    await ensureDir(SECRETS_DIR);

    const loaded = await this.loadRuntimeConfig();
    if (loaded) {
      this.config = loaded;
      this.logger.info("CONFIG_LOAD_OK", "Loaded runtime config", {
        profiles: loaded.profiles.length,
        activeProfileId: loaded.activeProfileId
      });
    } else {
      this.config = await this.migrateLegacyOrBootstrap();
      await this.persist("CONFIG_MIGRATED");
    }

    this.localEventToken = await this.ensureLocalEventToken();
    await this.syncLegacyConfig();
  }

  getConfig(): RuntimeConfig {
    return deepClone(this.requireConfig());
  }

  getLocalEventToken(): string {
    this.requireConfig();
    return this.localEventToken;
  }

  getActiveProfile(): VoiceProfile {
    const config = this.requireConfig();
    const profile = config.profiles.find((item) => item.id === config.activeProfileId);
    if (!profile) {
      throw new Error("E_PROFILE_ACTIVE_MISSING");
    }
    return deepClone(profile);
  }

  async createProfile(input: ProfileCreateInput): Promise<VoiceProfile> {
    const config = this.requireConfig();
    const parsed = ProfileCreateInputSchema.parse(input);

    const nowIso = new Date().toISOString();
    const profile: VoiceProfile = {
      id: profileIdFromName(parsed.name),
      name: parsed.name,
      voiceId: parsed.voiceId,
      voiceName: parsed.voiceName,
      wakeWord: parsed.wakeWord,
      wakeWordVariants: normalizeVariants(parsed.wakeWord, parsed.wakeWordVariants),
      model: parsed.model,
      stability: parsed.stability,
      similarityBoost: parsed.similarityBoost,
      style: parsed.style,
      elevenLabsApiKeyPath: parsed.elevenLabsApiKeyPath,
      telegramBotTokenPath: parsed.telegramBotTokenPath,
      telegramChatId: parsed.telegramChatId,
      silenceThreshold: parsed.silenceThreshold,
      speakerHost: parsed.speakerHost,
      speakerSshKey: parsed.speakerSshKey,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    config.profiles.push(profile);
    if (config.profiles.length === 1) {
      config.activeProfileId = profile.id;
    }

    await this.persist("PROFILE_CREATED");
    return deepClone(profile);
  }

  async updateProfile(profileId: string, patch: ProfilePatchInput): Promise<VoiceProfile> {
    const config = this.requireConfig();
    const parsed = ProfilePatchInputSchema.parse(patch);
    const index = config.profiles.findIndex((item) => item.id === profileId);
    if (index < 0) {
      throw new Error("E_PROFILE_NOT_FOUND");
    }

    const current = config.profiles[index];
    if (!current) {
      throw new Error("E_PROFILE_NOT_FOUND");
    }

    const wakeWord = parsed.wakeWord ?? current.wakeWord;
    const variants = normalizeVariants(wakeWord, parsed.wakeWordVariants ?? current.wakeWordVariants);

    const next: VoiceProfile = {
      ...current,
      ...parsed,
      wakeWord,
      wakeWordVariants: variants,
      updatedAt: new Date().toISOString(),
      id: current.id,
      createdAt: current.createdAt
    };

    config.profiles[index] = next;
    await this.persist("PROFILE_UPDATED");
    return deepClone(next);
  }

  async deleteProfile(profileId: string): Promise<void> {
    const config = this.requireConfig();
    const index = config.profiles.findIndex((item) => item.id === profileId);
    if (index < 0) {
      throw new Error("E_PROFILE_NOT_FOUND");
    }

    if (config.profiles.length === 1) {
      throw new Error("E_PROFILE_LAST_DELETE_BLOCKED");
    }

    config.profiles.splice(index, 1);

    if (config.activeProfileId === profileId) {
      const replacement = config.profiles[0];
      if (!replacement) {
        throw new Error("E_PROFILE_DELETE_FAILED");
      }
      config.activeProfileId = replacement.id;
    }

    await this.persist("PROFILE_DELETED");
  }

  async activateProfile(profileId: string): Promise<VoiceProfile> {
    const config = this.requireConfig();
    const profile = config.profiles.find((item) => item.id === profileId);
    if (!profile) {
      throw new Error("E_PROFILE_NOT_FOUND");
    }

    config.activeProfileId = profile.id;
    await this.persist("PROFILE_ACTIVATED");
    return deepClone(profile);
  }

  async upsertSetupProfile(input: ProfileCreateInput): Promise<VoiceProfile> {
    const config = this.requireConfig();
    const normalized = ProfileCreateInputSchema.parse(input);

    const existing = config.profiles.find((item) => item.name.toLowerCase() === normalized.name.toLowerCase());
    if (existing) {
      return this.updateProfile(existing.id, normalized);
    }

    if (config.profiles.length === 1 && config.profiles[0]?.id === "starter-profile") {
      return this.updateProfile("starter-profile", normalized);
    }

    return this.createProfile(normalized);
  }

  async setEventTransport(mode: "local" | "hybrid"): Promise<void> {
    const config = this.requireConfig();
    config.eventTransport = mode;
    await this.persist("EVENT_TRANSPORT_UPDATED");
  }

  private requireConfig(): RuntimeConfig {
    if (!this.config) {
      throw new Error("E_CONFIG_NOT_READY");
    }
    return this.config;
  }

  private async loadRuntimeConfig(): Promise<RuntimeConfig | null> {
    if (!(await pathExists(RUNTIME_CONFIG_PATH))) {
      return null;
    }

    const raw = await readJsonFile<unknown>(RUNTIME_CONFIG_PATH);
    return RuntimeConfigSchema.parse(raw);
  }

  private async migrateLegacyOrBootstrap(): Promise<RuntimeConfig> {
    const nowIso = new Date().toISOString();
    if (!(await pathExists(LEGACY_CONFIG_PATH))) {
      return {
        schemaVersion: 1,
        activeProfileId: "starter-profile",
        profiles: [starterProfile(nowIso)],
        eventTransport: "hybrid",
        localApiBaseUrl: DEFAULT_API_BASE_URL
      };
    }

    const rawLegacy = await readJsonFile<unknown>(LEGACY_CONFIG_PATH);
    const legacy = LegacyConfigSchema.parse(rawLegacy);

    const wakeWord = legacy.wake_word;
    const migratedProfile: VoiceProfile = {
      id: "legacy-profile",
      name: legacy.voice_name ? `${legacy.voice_name} Legacy` : "Legacy Profile",
      voiceId: legacy.voice_id,
      voiceName: legacy.voice_name ?? "Legacy Voice",
      wakeWord,
      wakeWordVariants: normalizeVariants(wakeWord, legacy.wake_word_variants),
      model: "eleven_multilingual_v2",
      stability: legacy.stability,
      similarityBoost: legacy.similarity_boost,
      style: legacy.style,
      elevenLabsApiKeyPath: legacy.elevenlabs_api_key_path,
      telegramBotTokenPath: legacy.telegram_bot_token_path,
      telegramChatId: legacy.telegram_chat_id,
      silenceThreshold: legacy.silence_threshold,
      speakerHost: legacy.speaker_host,
      speakerSshKey: legacy.speaker_ssh_key,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    return {
      schemaVersion: 1,
      activeProfileId: migratedProfile.id,
      profiles: [migratedProfile],
      eventTransport: "hybrid",
      localApiBaseUrl: DEFAULT_API_BASE_URL
    };
  }

  private async ensureLocalEventToken(): Promise<string> {
    if (await pathExists(LOCAL_EVENT_TOKEN_PATH)) {
      const token = (await fs.readFile(LOCAL_EVENT_TOKEN_PATH, "utf8")).trim();
      if (token.length >= 16) {
        return token;
      }
    }

    const token = crypto.randomBytes(24).toString("hex");
    await writeSecret(LOCAL_EVENT_TOKEN_PATH, token);
    return token;
  }

  private async syncLegacyConfig(): Promise<void> {
    const config = this.requireConfig();
    const active = config.profiles.find((item) => item.id === config.activeProfileId);
    if (!active) {
      throw new Error("E_PROFILE_ACTIVE_MISSING");
    }

    const legacy = {
      elevenlabs_api_key_path: active.elevenLabsApiKeyPath,
      voice_id: active.voiceId,
      voice_name: active.voiceName,
      model: active.model,
      stability: active.stability,
      similarity_boost: active.similarityBoost,
      style: active.style,
      wake_word: active.wakeWord,
      wake_word_variants: active.wakeWordVariants,
      speaker_host: active.speakerHost ?? "",
      speaker_ssh_key: active.speakerSshKey ?? "~/.ssh/id_ed25519",
      silence_threshold: active.silenceThreshold,
      telegram_bot_token_path: active.telegramBotTokenPath ?? "",
      telegram_chat_id: active.telegramChatId ?? ""
    };

    await writeJsonAtomic(LEGACY_CONFIG_PATH, legacy, 0o600);
  }

  private async persist(reason: string): Promise<void> {
    const config = this.requireConfig();
    RuntimeConfigSchema.parse(config);
    await writeJsonAtomic(RUNTIME_CONFIG_PATH, config, 0o600);
    await this.syncLegacyConfig();

    this.logger.info("CONFIG_SAVE_OK", "Runtime config persisted", {
      reason,
      profiles: config.profiles.length,
      activeProfileId: config.activeProfileId
    });
  }
}
