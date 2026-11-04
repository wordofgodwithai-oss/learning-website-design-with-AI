import "server-only";

import { planRank } from "@/lib/billing/shared";

/**
 * Feature gating.
 *
 * Local mode (`local-unlimited` plan or an unlimited ledger) keeps everything
 * unlocked so the clone is fully explorable without a payment provider. When
 * Stripe billing is active the plan on the ledger decides, using the minimum
 * plan recorded in `FEATURE_REQUIREMENTS` (REPORT.md section 11).
 *
 * Add-on flags can unlock individual features on top of the plan: e.g. the
 * script add-on enables `script_mode` on an otherwise lower plan.
 */

export const FEATURES = {
  script_mode: true,
  own_narration: true,
  user_media: true,
  screen_recording: true,
  ai_presenter: true,
  audio_only: true,
  voice_instructions: true,
  video_editing: true,
  watermark_removal: true,
  download: true,
  color: true,
  multilingual: true,
  custom_scene_selection: true,
  longer_videos: true,
  logo_upload: true,
  video_instructions: true,
  voice_cloning: true,
  own_voice: true,
  custom_canvas_styles: true,
  podcast: true,
  custom_music: true,
  character_consistency: true,
  api_access: true,
  priority_support: true,
  teams: true,
} as const;

export type Feature = keyof typeof FEATURES;

/** Copied from REPORT.md section 11 — the plan each feature normally needs. */
export const FEATURE_REQUIREMENTS: Record<Feature, string> = {
  script_mode: "free",
  own_narration: "business",
  user_media: "business",
  screen_recording: "business",
  ai_presenter: "creator",
  audio_only: "business",
  voice_instructions: "creator",
  video_editing: "starter",
  watermark_removal: "starter",
  download: "starter",
  color: "growth",
  multilingual: "creator",
  custom_scene_selection: "growth",
  longer_videos: "business",
  logo_upload: "business",
  video_instructions: "business",
  voice_cloning: "business",
  own_voice: "business",
  custom_canvas_styles: "business",
  podcast: "business",
  custom_music: "business",
  character_consistency: "scale",
  api_access: "scale",
  priority_support: "scale",
  teams: "business",
};

/** Add-ons that unlock a feature regardless of the plan tier. */
export const FEATURE_ADDONS: Partial<Record<Feature, string>> = {
  script_mode: "script",
  multilingual: "lang",
  watermark_removal: "watermark",
  video_instructions: "video_instruction",
  logo_upload: "logo",
  teams: "team",
  api_access: "api",
  longer_videos: "longer_videos",
};

export interface Entitlements {
  plan?: string | null;
  unlimited?: boolean;
  addons?: Record<string, boolean> | null;
}

/** The single gate used by the UI and the BFF. */
export function isFeatureUnlocked(
  feature: Feature,
  entitlements: Entitlements = {},
): boolean {
  const { plan = "local-unlimited", unlimited = false, addons = null } = entitlements;
  if (unlimited) return true;
  if (planRank(plan) >= planRank("local-unlimited")) return true;

  const addon = FEATURE_ADDONS[feature];
  if (addon && addons?.[addon]) return true;

  return planRank(plan) >= planRank(FEATURE_REQUIREMENTS[feature]);
}

/** Per-feature matrix — used by /api/auth/session and the playground UI. */
export function featureMatrix(entitlements: Entitlements = {}): Record<Feature, boolean> {
  return Object.fromEntries(
    (Object.keys(FEATURES) as Feature[]).map((feature) => [
      feature,
      isFeatureUnlocked(feature, entitlements),
    ]),
  ) as Record<Feature, boolean>;
}
