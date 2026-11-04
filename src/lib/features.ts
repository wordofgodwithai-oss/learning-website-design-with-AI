import "server-only";

/**
 * ===========================================================================
 * FEATURE GATING — intentionally bypassed in local mode.
 *
 * The real product gates features by plan/subscription and by add-on flags on
 * the `user_credits` row (REPORT.md sections 8 and 11). All checks below
 * return true so every feature is usable locally.
 *
 * TODO(REAL-GATING): replace `isFeatureUnlocked` with a real entitlement check
 * that reads the plan + add-on flags and enforces limits server-side. The
 * minimum plan for each feature is recorded in `FEATURE_REQUIREMENTS` so the
 * upgrade prompts can be restored without re-deriving them from the report.
 * ===========================================================================
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

/**
 * The single gate used by the UI and the BFF.
 * TODO(REAL-GATING): return the real entitlement instead of `true`.
 */
export function isFeatureUnlocked(_feature: Feature): boolean {
  void _feature;
  return true;
}

/** Everything unlocked — used by /api/auth/session and the playground UI. */
export function featureMatrix(): Record<Feature, boolean> {
  return Object.fromEntries(
    (Object.keys(FEATURES) as Feature[]).map((feature) => [feature, isFeatureUnlocked(feature)]),
  ) as Record<Feature, boolean>;
}
