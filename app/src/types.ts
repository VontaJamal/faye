import { z } from "zod";

const percentRegex = /^\d+(\.\d+)?%$/;
const profileIdRegex = /^[a-z0-9-]{3,64}$/;

export const VoiceProfileSchema = z.object({
  id: z.string().regex(profileIdRegex),
  name: z.string().min(1).max(80),
  voiceId: z.string().min(1).max(128),
  voiceName: z.string().min(1).max(128),
  wakeWord: z.string().min(1).max(120),
  wakeWordVariants: z.array(z.string().min(1).max(120)).min(1).max(24),
  model: z.literal("eleven_multilingual_v2"),
  stability: z.number().min(0).max(1),
  similarityBoost: z.number().min(0).max(1),
  style: z.number().min(0).max(1),
  elevenLabsApiKeyPath: z.string().min(1),
  telegramBotTokenPath: z.string().min(1).optional(),
  telegramChatId: z.string().max(64).optional(),
  silenceThreshold: z.string().regex(percentRegex),
  speakerHost: z.string().max(120).optional(),
  speakerSshKey: z.string().max(512).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const RuntimeConfigSchema = z.object({
  schemaVersion: z.literal(1),
  activeProfileId: z.string().regex(profileIdRegex),
  profiles: z.array(VoiceProfileSchema).min(1),
  eventTransport: z.enum(["local", "hybrid"]),
  localApiBaseUrl: z.literal("http://127.0.0.1:4587")
});

export const LegacyConfigSchema = z
  .object({
    elevenlabs_api_key_path: z.string(),
    voice_id: z.string(),
    voice_name: z.string().optional(),
    model: z.string().default("eleven_multilingual_v2"),
    stability: z.number().default(0.4),
    similarity_boost: z.number().default(0.8),
    style: z.number().default(0.7),
    wake_word: z.string().default("Faye Arise"),
    wake_word_variants: z.array(z.string()).optional(),
    silence_threshold: z.string().default("0.5%"),
    telegram_bot_token_path: z.string().optional(),
    telegram_chat_id: z.string().optional(),
    speaker_host: z.string().optional(),
    speaker_ssh_key: z.string().optional()
  })
  .passthrough();

export const ProfileCreateInputSchema = z.object({
  name: z.string().min(1).max(80),
  voiceId: z.string().min(1).max(128),
  voiceName: z.string().min(1).max(128),
  wakeWord: z.string().min(1).max(120),
  wakeWordVariants: z.array(z.string().min(1).max(120)).optional(),
  model: z.literal("eleven_multilingual_v2").default("eleven_multilingual_v2"),
  stability: z.number().min(0).max(1).default(0.4),
  similarityBoost: z.number().min(0).max(1).default(0.8),
  style: z.number().min(0).max(1).default(0.7),
  elevenLabsApiKeyPath: z.string().min(1),
  telegramBotTokenPath: z.string().min(1).optional(),
  telegramChatId: z.string().max(64).optional(),
  silenceThreshold: z.string().regex(percentRegex).default("0.5%"),
  speakerHost: z.string().max(120).optional(),
  speakerSshKey: z.string().max(512).optional()
});

export const ProfilePatchInputSchema = ProfileCreateInputSchema.partial().extend({
  id: z.string().regex(profileIdRegex).optional()
});

export const SpeakTestInputSchema = z.object({
  text: z.string().min(1).max(400).default("Faye voice test successful."),
  profileId: z.string().regex(profileIdRegex).optional()
});

export const SetupInputSchema = z.object({
  profileName: z.string().min(1).max(80).default("Primary Voice"),
  apiKey: z.string().min(1).optional(),
  voiceId: z.string().min(1).max(128),
  voiceName: z.string().min(1).max(128),
  wakeWord: z.string().min(1).max(120).default("Faye Arise"),
  telegramToken: z.string().min(1).optional(),
  telegramChatId: z.string().max(64).optional(),
  eventTransport: z.enum(["local", "hybrid"]).default("hybrid")
});

export const LocalIngestEventSchema = z.object({
  type: z.enum([
    "wake_detected",
    "message_transcribed",
    "listener_error",
    "listener_status",
    "bridge_speak_received",
    "bridge_spoken",
    "bridge_action_requested",
    "bridge_action_executed",
    "bridge_action_blocked"
  ]),
  payload: z.record(z.unknown()).default({})
});

export const BridgeActionNameSchema = z.enum([
  "health_summary",
  "voice_test",
  "listener_restart",
  "bridge_restart"
]);

export const ConversationTurnPolicySchema = z.object({
  baseTurns: z.number().int().min(1).max(32),
  extendBy: z.number().int().min(1).max(16),
  hardCap: z.number().int().min(1).max(64)
});

export const InstallAttemptStepSchema = z.object({
  name: z.string().min(1).max(120),
  ok: z.boolean(),
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(500).optional(),
  durationMs: z.number().int().min(0).optional()
});

export const InstallAttemptReportSchema = z.object({
  schemaVersion: z.literal(1),
  attemptId: z.string().min(8).max(80),
  generatedAt: z.string().datetime(),
  source: z.enum(["install.sh", "bootstrap.sh", "faye-first-success", "manual"]),
  success: z.boolean(),
  durationMs: z.number().int().min(0),
  platform: z.string().min(1).max(80),
  nodeVersion: z.string().min(1).max(32).optional(),
  doctorOk: z.boolean().nullable(),
  servicesOk: z.boolean().nullable(),
  firstSpeakOk: z.boolean().nullable(),
  steps: z.array(InstallAttemptStepSchema).min(1),
  notes: z.array(z.string().min(1).max(240)).default([])
});

export const UxKpiFailureSchema = z.object({
  at: z.string().datetime(),
  action: z.enum(["setup", "voice-test", "listener-restart", "bridge-restart"]),
  error: z.string().min(1).max(280)
});

export const UxKpiReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  firstSetupAt: z.string().datetime().nullable(),
  firstVoiceSuccessAt: z.string().datetime().nullable(),
  lastVoiceTestAt: z.string().datetime().nullable(),
  lastVoiceTestOk: z.boolean().nullable(),
  timeToFirstSuccessMs: z.number().int().min(0).nullable(),
  counters: z.object({
    setupAttempts: z.number().int().min(0),
    setupSuccesses: z.number().int().min(0),
    setupFailures: z.number().int().min(0),
    listenerRestartAttempts: z.number().int().min(0),
    listenerRestartFailures: z.number().int().min(0),
    bridgeRestartAttempts: z.number().int().min(0),
    bridgeRestartFailures: z.number().int().min(0),
    voiceTestAttempts: z.number().int().min(0),
    voiceTestSuccesses: z.number().int().min(0),
    voiceTestFailures: z.number().int().min(0)
  }),
  recentFailures: z.array(UxKpiFailureSchema).max(20)
});

export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
export type ProfileCreateInput = z.infer<typeof ProfileCreateInputSchema>;
export type ProfilePatchInput = z.infer<typeof ProfilePatchInputSchema>;
export type SpeakTestInput = z.infer<typeof SpeakTestInputSchema>;
export type SetupInput = z.infer<typeof SetupInputSchema>;
export type LocalIngestEvent = z.infer<typeof LocalIngestEventSchema>;
export type BridgeActionName = z.infer<typeof BridgeActionNameSchema>;
export type ConversationTurnPolicy = z.infer<typeof ConversationTurnPolicySchema>;
export type InstallAttemptStep = z.infer<typeof InstallAttemptStepSchema>;
export type InstallAttemptReport = z.infer<typeof InstallAttemptReportSchema>;
export type UxKpiFailure = z.infer<typeof UxKpiFailureSchema>;
export type UxKpiReport = z.infer<typeof UxKpiReportSchema>;

export function normalizeVariants(wakeWord: string, variants?: string[]): string[] {
  const source = variants && variants.length > 0 ? variants : [wakeWord];
  const unique = new Set(
    source
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0)
  );

  if (!unique.has(wakeWord.trim().toLowerCase())) {
    unique.add(wakeWord.trim().toLowerCase());
  }

  return [...unique].slice(0, 24);
}
