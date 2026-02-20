import fs from "node:fs/promises";

import type { Logger } from "./logger";
import type { VoiceProfile } from "./types";
import { expandHomePath, readSecret } from "./utils";

interface HttpResult {
  ok: boolean;
  status: number;
  bodyText: string;
  bodyBytes?: Uint8Array;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class ElevenLabsClient {
  constructor(private readonly logger: Logger) {}

  async synthesizeToFile(profile: VoiceProfile, text: string, outputPath: string): Promise<void> {
    const apiKeyPath = expandHomePath(profile.elevenLabsApiKeyPath);
    const apiKey = await readSecret(apiKeyPath);

    const payload = {
      text,
      model_id: profile.model,
      voice_settings: {
        stability: profile.stability,
        similarity_boost: profile.similarityBoost,
        style: profile.style
      }
    };

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(profile.voiceId)}`;

    const response = await this.requestWithRetry(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok || !response.bodyBytes) {
      this.logger.error("ELEVENLABS_TTS_FAILED", "TTS request failed", {
        status: response.status,
        body: response.bodyText.slice(0, 200)
      });
      throw new Error("E_ELEVENLABS_TTS_FAILED");
    }

    await fs.writeFile(outputPath, response.bodyBytes);
  }

  private async requestWithRetry(url: string, init: RequestInit): Promise<HttpResult> {
    const maxAttempts = 3;
    let lastStatus = 0;
    let lastBody = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);

      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal
        });

        clearTimeout(timeout);

        const bodyBytes = new Uint8Array(await response.arrayBuffer());
        const bodyText = new TextDecoder().decode(bodyBytes);

        if (response.ok) {
          return {
            ok: true,
            status: response.status,
            bodyText,
            bodyBytes
          };
        }

        lastStatus = response.status;
        lastBody = bodyText;

        const retryable = response.status >= 500 || response.status === 429;
        if (!retryable || attempt === maxAttempts) {
          return {
            ok: false,
            status: response.status,
            bodyText
          };
        }

        await sleep(350 * attempt);
      } catch (error) {
        clearTimeout(timeout);
        lastStatus = 0;
        lastBody = String(error);

        if (attempt === maxAttempts) {
          break;
        }

        await sleep(350 * attempt);
      }
    }

    return {
      ok: false,
      status: lastStatus,
      bodyText: lastBody
    };
  }
}
