import "server-only";

import { existsSync } from "node:fs";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

/**
 * ===========================================================================
 * Integration modes.
 *
 * Every external service is optional. Each capability resolves to one of two
 * modes from the environment:
 *
 *   local  — the deterministic, dependency-free implementation (default when
 *            no credentials are present, so the app always runs)
 *   live   — the real provider, enabled automatically as soon as its
 *            credentials exist, or explicitly through GOLPO_*_MODE
 *
 * The point of `auto` is that `.env.local` is the only switch. Put a
 * GROQ_API_KEY in it and scripts, transcription and narration become real;
 * set the GOLPO_DB_* variables to point at MySQL, and put a Stripe key in and
 * billing becomes real. Remove them and the app falls back without a code
 * change.
 *
 * Modes are read once per server process. Restart `npm run dev` after editing
 * `.env.local` (Next.js already does this).
 * ===========================================================================
 */

export type ScriptMode = "local" | "groq";
export type RenderMode = "storyboard" | "ffmpeg";
export type BillingMode = "mock" | "stripe";
export type TtsMode = "none" | "groq" | "edge";
export type TranscriptionMode = "none" | "groq";
export type ImageMode = "off" | "cloudflare" | "pollinations";

function text(value: string | undefined): string {
  return (value ?? "").trim();
}

function flag(value: string | undefined): boolean {
  const normalized = text(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function resolveMode<T extends string>(
  raw: string | undefined,
  auto: T,
  allowed: readonly T[],
): T {
  const normalized = text(raw).toLowerCase();
  if (!normalized || normalized === "auto") return auto;
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : auto;
}

// ---------------------------------------------------------------------------
// Groq (scripts, transcription and narration)
//
// Groq exposes an OpenAI-compatible surface under /openai/v1, so the same fetch
// code works with a single key. See src/lib/ai/groq.ts.
// ---------------------------------------------------------------------------

export const GROQ_API_KEY = text(process.env.GROQ_API_KEY);
export const GROQ_BASE_URL =
  text(process.env.GROQ_BASE_URL) || "https://api.groq.com/openai/v1";
export const GROQ_MODEL =
  text(process.env.GOLPO_GROQ_MODEL) || "openai/gpt-oss-120b";
export const GROQ_TRANSCRIBE_MODEL =
  text(process.env.GOLPO_GROQ_TRANSCRIBE_MODEL) || "whisper-large-v3";
export const GROQ_TTS_MODEL =
  text(process.env.GOLPO_GROQ_TTS_MODEL) || "canopylabs/orpheus-v1-english";
export const GROQ_TTS_VOICE = text(process.env.GOLPO_GROQ_TTS_VOICE) || "hannah";
export const GROQ_TIMEOUT_MS = Number(process.env.GOLPO_GROQ_TIMEOUT_MS ?? 45_000);

export const scriptMode: ScriptMode = resolveMode<ScriptMode>(
  process.env.GOLPO_SCRIPT_MODE,
  GROQ_API_KEY ? "groq" : "local",
  ["local", "groq"],
);

export const ttsMode: TtsMode = resolveMode<TtsMode>(
  process.env.GOLPO_TTS_MODE,
  GROQ_API_KEY ? "groq" : "edge",
  ["none", "groq", "edge"],
);

export const transcriptionMode: TranscriptionMode = resolveMode<TranscriptionMode>(
  process.env.GOLPO_TRANSCRIBE_MODE,
  GROQ_API_KEY ? "groq" : "none",
  ["none", "groq"],
);

// ---------------------------------------------------------------------------
// Scene artwork (free image generation)
//
// Cloudflare Workers AI gives 10,000 free neurons/day, which is roughly 100
// FLUX.1-schnell images. Pollinations needs no key at all but throttles to one
// image per 45 seconds per IP. The default picks Cloudflare when its
// credentials exist and Pollinations otherwise, so scenes are illustrated with
// zero setup; set GOLPO_IMAGE_MODE=off to stay on the local vector doodles.
// ---------------------------------------------------------------------------

export const CLOUDFLARE_ACCOUNT_ID = text(process.env.CLOUDFLARE_ACCOUNT_ID);
export const CLOUDFLARE_AI_TOKEN = text(process.env.CLOUDFLARE_AI_TOKEN);
export const CLOUDFLARE_IMAGE_MODEL =
  text(process.env.GOLPO_CLOUDFLARE_IMAGE_MODEL) ||
  "@cf/black-forest-labs/flux-1-schnell";
export const POLLINATIONS_BASE_URL =
  text(process.env.GOLPO_POLLINATIONS_URL) || "https://image.pollinations.ai";

const cloudflareReady = Boolean(CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_AI_TOKEN);

export const imageMode: ImageMode = resolveMode<ImageMode>(
  process.env.GOLPO_IMAGE_MODE,
  cloudflareReady ? "cloudflare" : "pollinations",
  ["off", "cloudflare", "pollinations"],
);

/** Pollinations is rate limited per IP; keep a safe gap between requests. */
export const POLLINATIONS_INTERVAL_MS = Math.max(
  0,
  Number(process.env.GOLPO_POLLINATIONS_INTERVAL_MS ?? 46_000),
);

export const IMAGE_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.GOLPO_IMAGE_TIMEOUT_MS ?? 90_000),
);

// ---------------------------------------------------------------------------
// Render (FFmpeg + sharp). Binaries ship with the npm packages, so "auto" can
// simply check that they exist.
// ---------------------------------------------------------------------------

function binaryPath(candidate: string | null | undefined): string | null {
  return candidate && existsSync(candidate) ? candidate : null;
}

export const FFMPEG_PATH = binaryPath(ffmpegStatic);
export const FFPROBE_PATH = binaryPath(ffprobeStatic.path);

export const renderMode: RenderMode = resolveMode<RenderMode>(
  process.env.GOLPO_RENDER_MODE,
  FFMPEG_PATH && FFPROBE_PATH ? "ffmpeg" : "storyboard",
  ["storyboard", "ffmpeg"],
);

// ---------------------------------------------------------------------------
// Stripe (billing)
// ---------------------------------------------------------------------------

export const STRIPE_SECRET_KEY = text(process.env.STRIPE_SECRET_KEY);
export const STRIPE_WEBHOOK_SECRET = text(process.env.STRIPE_WEBHOOK_SECRET);
export const STRIPE_CURRENCY = (text(process.env.GOLPO_STRIPE_CURRENCY) || "usd").toLowerCase();
export const APP_URL =
  text(process.env.GOLPO_APP_URL) || text(process.env.NEXT_PUBLIC_APP_URL) || "http://localhost:3000";

export const billingMode: BillingMode = resolveMode<BillingMode>(
  process.env.GOLPO_BILLING_MODE,
  STRIPE_SECRET_KEY ? "stripe" : "mock",
  ["mock", "stripe"],
);

/**
 * Escape hatch: keep unlimited credits even with Stripe configured (useful
 * while testing the integration without paying). Defaults to on in mock mode
 * and off in stripe mode.
 */
export const unlimitedDevOverride = flag(process.env.GOLPO_UNLIMITED_DEV)
  ? true
  : !STRIPE_SECRET_KEY && billingMode === "mock";

// ---------------------------------------------------------------------------
// Client-safe view (never include secrets)
// ---------------------------------------------------------------------------

export interface PublicIntegrationConfig {
  billingMode: BillingMode;
  scriptMode: ScriptMode;
  renderMode: RenderMode;
  unlimited: boolean;
  model: string | null;
}

export function publicConfig(): PublicIntegrationConfig {
  return {
    billingMode,
    scriptMode,
    renderMode: renderMode,
    unlimited: unlimitedDevOverride,
    model: scriptMode === "groq" ? GROQ_MODEL : null,
  };
}

/** Compact one-line summary for /api/health and the startup logs. */
export function integrationSummary(): Record<string, string> {
  return {
    auth: "mysql",
    billing: billingMode,
    scripts: scriptMode === "groq" ? `groq:${GROQ_MODEL}` : "local",
    transcription:
      transcriptionMode === "groq" ? `groq:${GROQ_TRANSCRIBE_MODEL}` : "none",
    narration:
      ttsMode === "groq"
        ? `groq:${GROQ_TTS_MODEL}`
        : ttsMode === "edge"
          ? "edge:multilingual"
          : "silent",
    artwork:
      imageMode === "cloudflare"
        ? `cloudflare:${CLOUDFLARE_IMAGE_MODEL}`
        : imageMode === "pollinations"
          ? "pollinations:flux"
          : "vector-doodles",
    render: renderMode === "ffmpeg" ? "ffmpeg" : "storyboard",
  };
}
