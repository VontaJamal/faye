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
  type: z.enum(["wake_detected", "message_transcribed", "listener_error", "listener_status"]),
  payload: z.record(z.unknown()).default({})
});

export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
export type ProfileCreateInput = z.infer<typeof ProfileCreateInputSchema>;
export type ProfilePatchInput = z.infer<typeof ProfilePatchInputSchema>;
export type SpeakTestInput = z.infer<typeof SpeakTestInputSchema>;
export type SetupInput = z.infer<typeof SetupInputSchema>;
export type LocalIngestEvent = z.infer<typeof LocalIngestEventSchema>;

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
