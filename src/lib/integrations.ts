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
 * The point of `auto` is that `.env.local` is the only switch. Put an
 * OPENAI_API_KEY in it and scripts become real; put Supabase keys in and auth
 * becomes real; put a Stripe key in and billing becomes real. Remove them and
 * the app falls back without a code change.
 *
 * Modes are read once per server process. Restart `npm run dev` after editing
 * `.env.local` (Next.js already does this).
 * ===========================================================================
 */

export type ScriptMode = "local" | "openai";
export type RenderMode = "storyboard" | "ffmpeg";
export type AuthMode = "local" | "supabase";
export type BillingMode = "mock" | "stripe";
export type TtsMode = "none" | "openai";

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
// OpenAI (scripts + narration)
// ---------------------------------------------------------------------------

export const OPENAI_API_KEY = text(process.env.OPENAI_API_KEY);
export const OPENAI_BASE_URL = text(process.env.OPENAI_BASE_URL) || "https://api.openai.com/v1";
export const OPENAI_MODEL = text(process.env.GOLPO_OPENAI_MODEL) || "gpt-4o-mini";
export const OPENAI_TTS_MODEL = text(process.env.GOLPO_OPENAI_TTS_MODEL) || "tts-1";
export const OPENAI_TTS_VOICE = text(process.env.GOLPO_OPENAI_TTS_VOICE) || "alloy";
export const OPENAI_TIMEOUT_MS = Number(process.env.GOLPO_OPENAI_TIMEOUT_MS ?? 45_000);

export const scriptMode: ScriptMode = resolveMode<ScriptMode>(
  process.env.GOLPO_SCRIPT_MODE,
  OPENAI_API_KEY ? "openai" : "local",
  ["local", "openai"],
);

export const ttsMode: TtsMode = resolveMode<TtsMode>(
  process.env.GOLPO_TTS_MODE,
  OPENAI_API_KEY ? "openai" : "none",
  ["none", "openai"],
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
// Supabase (auth)
// ---------------------------------------------------------------------------

/**
 * Supabase clients want the project origin, not a REST endpoint. People often
 * copy the dashboard's `.../rest/v1/` URL into `.env.local`; strip any such
 * suffix so `/auth/v1/...` still resolves correctly.
 */
function supabaseOrigin(value: string): string {
  return value
    .replace(/\/+$/, "")
    .replace(/\/rest\/v1$/, "")
    .replace(/\/+$/, "");
}

export const SUPABASE_URL = supabaseOrigin(
  text(process.env.SUPABASE_URL) || text(process.env.NEXT_PUBLIC_SUPABASE_URL),
);
export const SUPABASE_ANON_KEY =
  text(process.env.SUPABASE_ANON_KEY) || text(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
export const SUPABASE_SERVICE_ROLE_KEY = text(process.env.SUPABASE_SERVICE_ROLE_KEY);

export const authMode: AuthMode = resolveMode<AuthMode>(
  process.env.GOLPO_AUTH_MODE,
  SUPABASE_URL && SUPABASE_ANON_KEY ? "supabase" : "local",
  ["local", "supabase"],
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
  authMode: AuthMode;
  billingMode: BillingMode;
  scriptMode: ScriptMode;
  renderMode: RenderMode;
  unlimited: boolean;
  supabase: { url: string; anonKey: string } | null;
  model: string | null;
}

export function publicConfig(): PublicIntegrationConfig {
  return {
    authMode,
    billingMode,
    scriptMode,
    renderMode: renderMode,
    unlimited: unlimitedDevOverride,
    supabase:
      authMode === "supabase" && SUPABASE_URL && SUPABASE_ANON_KEY
        ? { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }
        : null,
    model: scriptMode === "openai" ? OPENAI_MODEL : null,
  };
}

/** Compact one-line summary for /api/health and the startup logs. */
export function integrationSummary(): Record<string, string> {
  return {
    auth: authMode,
    billing: billingMode,
    scripts: scriptMode === "openai" ? `openai:${OPENAI_MODEL}` : "local",
    narration: ttsMode === "openai" ? `openai:${OPENAI_TTS_MODEL}` : "silent",
    render: renderMode === "ffmpeg" ? "ffmpeg" : "storyboard",
  };
}
