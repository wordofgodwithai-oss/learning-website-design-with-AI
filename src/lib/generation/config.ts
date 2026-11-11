/**
 * Style, language, voice, music and timing catalogues.
 *
 * Every list here is transcribed from the signed-in product capture on
 * 11 Nov 2026 (`docs/forensics/live/audit-notes.txt`) rather than inferred from
 * the API reference. The live app ships three engines, each with its own
 * eleven-style catalogue, so the picker must be resolved per engine — see
 * `ENGINE_CAPABILITIES`.
 */

import type { Engine } from "@/lib/types";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/** Golpo Canvas — "11 styles, each Compact or Expanded (Notebook: Compact only)". */
export const CANVAS_STYLES = [
  "chalkboard_white_on_black",
  "chalkboard_black_on_white",
  "chalkboard_color",
  "whiteboard",
  "modern_minimal",
  "playful",
  "technical",
  "editorial",
  "sharpie",
  "illustration",
  "notebook",
] as const;

/** Golpo Sketch — 11 presets. */
export const SKETCH_STYLES = [
  "classic",
  "classic_with_words",
  "chalkboard_black_on_white",
  "improved",
  "dry_erase",
  "professional_clean",
  "crayon",
  "infographics",
  "creative",
  "formal",
  "formal_legacy",
] as const;

/** Golpo Studio — 11 motion styles (Growth+ in the real product). */
export const STUDIO_STYLES = [
  "colorful_sketch",
  "khan_academy",
  "chalkboard",
  "bold_marker",
  "simple_sketch",
  "marker_cartoon",
  "brightboard",
  "neon_blackboard",
  "notebook",
  "expressive_editorial_marker",
  "signature_whiteboard",
] as const;

export const CANVAS_STYLE_VARIANTS = ["compact", "expanded"] as const;

/** Display labels, exactly as the product spells them. */
export const STYLE_LABELS: Record<string, string> = {
  chalkboard_white_on_black: "Chalkboard (White on Black)",
  chalkboard_black_on_white: "Chalkboard (Black on White)",
  chalkboard_color: "Chalkboard Color",
  whiteboard: "Whiteboard",
  modern_minimal: "Modern Minimal",
  playful: "Playful",
  technical: "Technical",
  editorial: "Editorial",
  sharpie: "Sharpie",
  illustration: "Illustration",
  notebook: "Notebook",
  classic: "Classic",
  classic_with_words: "Classic (with Words)",
  improved: "Improved",
  dry_erase: "Dry Erase",
  professional_clean: "Professional Clean",
  crayon: "Crayon",
  infographics: "Infographics",
  creative: "Creative",
  formal: "Formal",
  formal_legacy: "Formal (Legacy)",
  colorful_sketch: "Colorful Sketch",
  khan_academy: "Khan Academy",
  chalkboard: "Chalkboard",
  bold_marker: "Bold Marker",
  simple_sketch: "Simple Sketch",
  marker_cartoon: "Marker Cartoon",
  brightboard: "Brightboard",
  neon_blackboard: "Neon Blackboard",
  expressive_editorial_marker: "Expressive Editorial Marker",
  signature_whiteboard: "Signature Whiteboard",
  // Legacy ids kept so rows rendered before this catalogue existed still resolve.
  neon: "Neon",
  marker: "Marker",
  vox: "Vox",
  "dry erase": "Dry Erase",
};

export function styleLabel(value: string): string {
  return STYLE_LABELS[value] ?? value.replace(/[_-]+/g, " ");
}

export function stylesForEngine(engine: Engine): readonly string[] {
  if (engine === "golpo_sketch") return SKETCH_STYLES;
  if (engine === "golpo_studio") return STUDIO_STYLES;
  return CANVAS_STYLES;
}

/** Notebook is the only Canvas style without an Expanded profile. */
export function isCompactOnly(style: string): boolean {
  return style === "notebook";
}

/** Pen-in-hand is a tool, not a speed: `stylus | marker | pen`. */
export const PEN_ANIMATION_STYLES = [
  { id: "none", label: "None", plan: null },
  { id: "stylus", label: "Stylus", plan: "business" },
  { id: "marker", label: "Marker", plan: "business" },
  { id: "pen", label: "Pen", plan: "business" },
] as const;

/** `frame_transition` — Canvas only in the live product. */
export const FRAME_TRANSITIONS = [
  { id: "none", label: "None" },
  { id: "hand_slide", label: "Hand slide animation" },
  { id: "slide_left", label: "Slide left" },
  { id: "slide_right", label: "Slide right" },
  { id: "slide_up", label: "Slide up" },
  { id: "slide_down", label: "Slide down" },
  { id: "zoom_in", label: "Zoom in" },
  { id: "zoom_out", label: "Zoom out" },
] as const;

export const FRAME_TRANSITION_IDS: readonly string[] = FRAME_TRANSITIONS.map((entry) => entry.id);

export const IMAGE_GENERATION_MODELS = ["default", "illustration", "lineart"] as const;

export const PEN_STYLES = ["classic", "pen_in_hand", "formal"] as const;

export const PACING = ["normal", "fast"] as const;

export const TIMING = ["auto", "scene_by_scene", "narrator_led"] as const;

/**
 * Which settings each engine exposes. Transcribed from the live panel:
 * Sketch has no display-language or pen-in-hand control and its frame
 * transition is rendered disabled; Studio has no pacing or frame transition.
 */
export const ENGINE_CAPABILITIES: Record<
  Engine,
  {
    displayLanguage: boolean;
    frameTransition: boolean;
    pacing: boolean;
    penInHand: boolean;
    styleLabel: string;
    musicHasAuto: boolean;
    creditsPerMinute: number;
  }
> = {
  golpo_canvas: {
    displayLanguage: true,
    frameTransition: true,
    pacing: true,
    penInHand: true,
    styleLabel: "Golpo Canvas style",
    musicHasAuto: false,
    creditsPerMinute: 1,
  },
  golpo_studio: {
    displayLanguage: true,
    frameTransition: false,
    pacing: false,
    penInHand: true,
    styleLabel: "Style",
    musicHasAuto: true,
    creditsPerMinute: 2,
  },
  golpo_sketch: {
    displayLanguage: false,
    frameTransition: false,
    pacing: true,
    penInHand: false,
    styleLabel: "Video style",
    musicHasAuto: false,
    creditsPerMinute: 1,
  },
};

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

export interface Language {
  code: string;
  name: string;
}

export const LANGUAGES: Language[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "de-CH", name: "German (Switzerland)" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "zh-CN", name: "Chinese" },
  { code: "zh-HK", name: "Chinese (Cantonese)" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "nl", name: "Dutch" },
  { code: "pl", name: "Polish" },
  { code: "sv", name: "Swedish" },
  { code: "no", name: "Norwegian" },
  { code: "da", name: "Danish" },
  { code: "fi", name: "Finnish" },
  { code: "tr", name: "Turkish" },
  { code: "el", name: "Greek" },
  { code: "he", name: "Hebrew" },
  { code: "th", name: "Thai" },
  { code: "vi", name: "Vietnamese" },
  { code: "id", name: "Indonesian" },
  { code: "ms", name: "Malay" },
  { code: "fil", name: "Filipino" },
  { code: "cs", name: "Czech" },
  { code: "hu", name: "Hungarian" },
  { code: "ro", name: "Romanian" },
  { code: "bg", name: "Bulgarian" },
  { code: "hr", name: "Croatian" },
  { code: "sr", name: "Serbian" },
  { code: "sk", name: "Slovak" },
  { code: "sl", name: "Slovenian" },
  { code: "uk", name: "Ukrainian" },
  { code: "bn", name: "Bengali" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "mr", name: "Marathi" },
  { code: "gu", name: "Gujarati" },
  { code: "ur", name: "Urdu" },
  { code: "fa", name: "Persian" },
  { code: "sw", name: "Swahili" },
  { code: "af", name: "Afrikaans" },
  { code: "it", name: "Italian" },
];

export function languageName(code: string): string {
  return LANGUAGES.find((language) => language.code === code)?.name ?? "English";
}

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

export interface Voice {
  id: string;
  name: string;
  gender: "female" | "male" | "neutral";
  accent: string;
}

/** `female-1…7` / `male-1…7`, plus the dual-voice Conversational option. */
export const VOICES: Voice[] = [
  { id: "conversational", name: "Conversational", gender: "neutral", accent: "Two voices" },
  { id: "female-1", name: "Female 1", gender: "female", accent: "American" },
  { id: "female-2", name: "Female 2", gender: "female", accent: "British" },
  { id: "female-3", name: "Female 3", gender: "female", accent: "Indian" },
  { id: "female-4", name: "Female 4", gender: "female", accent: "Australian" },
  { id: "female-5", name: "Female 5", gender: "female", accent: "Irish" },
  { id: "female-6", name: "Female 6", gender: "female", accent: "Canadian" },
  { id: "female-7", name: "Female 7", gender: "female", accent: "South African" },
  { id: "male-1", name: "Male 1", gender: "male", accent: "American" },
  { id: "male-2", name: "Male 2", gender: "male", accent: "British" },
  { id: "male-3", name: "Male 3", gender: "male", accent: "Indian" },
  { id: "male-4", name: "Male 4", gender: "male", accent: "Australian" },
  { id: "male-5", name: "Male 5", gender: "male", accent: "Irish" },
  { id: "male-6", name: "Male 6", gender: "male", accent: "Canadian" },
  { id: "male-7", name: "Male 7", gender: "male", accent: "South African" },
];

export const DEFAULT_VOICE = "female-1";

export function voiceGender(voice: string | null | undefined): "female" | "male" | "neutral" | undefined {
  const key = (voice ?? "").trim().toLowerCase();
  if (!key) return undefined;
  const match = VOICES.find((entry) => entry.id === key);
  if (match) return match.gender;
  // Legacy ids from earlier local renders.
  if (["ava", "isla", "maya", "amara"].includes(key)) return "female";
  if (["noah", "oliver", "luca"].includes(key)) return "male";
  if (key.includes("female")) return "female";
  if (key.includes("male")) return "male";
  return "neutral";
}

// ---------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------

export interface MusicPreset {
  id: string;
  label: string;
  seconds: number;
}

/** The seven presets shown under "PRESETS · 7", with their real lengths. */
export const MUSIC_PRESETS: MusicPreset[] = [
  { id: "engaging", label: "Engaging", seconds: 235 },
  { id: "hyper", label: "Hyper", seconds: 280 },
  { id: "inspirational", label: "Inspirational", seconds: 171 },
  { id: "documentary", label: "Documentary", seconds: 333 },
  { id: "jazz", label: "Jazz", seconds: 179 },
  { id: "lofi", label: "Lo-fi", seconds: 154 },
  { id: "dramatic", label: "Dramatic", seconds: 220 },
];

export const MUSIC_PRESET_IDS = MUSIC_PRESETS.map((entry) => entry.id);

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

/**
 * The live duration ladder. The Free plan only unlocks 1 min; everything here
 * is selectable locally because billing is mocked.
 */
export const DURATION_CHOICES = [
  { id: "15s", seconds: 15, label: "15 sec" },
  { id: "30s", seconds: 30, label: "30 sec" },
  { id: "1m", seconds: 60, label: "1 min" },
  { id: "2m", seconds: 120, label: "2 min" },
  { id: "4m", seconds: 240, label: "4 min" },
  { id: "8m", seconds: 480, label: "8 min" },
  { id: "10m", seconds: 600, label: "10 min" },
  { id: "15m", seconds: 900, label: "15 min" },
] as const;

export const DEFAULT_DURATION_SECONDS = 60;

export const AVATAR_RENDERERS = ["studio", "whiteboard", "cutout"] as const;
export const AVATAR_PRESENTATION_MODES = ["full_body", "half_body", "head"] as const;
export const AVATAR_STYLIZATION = true;

export const OWN_NARRATION_PIP_POSITIONS = [
  "bottom_right",
  "bottom_left",
  "top_right",
  "top_left",
] as const;
export const OWN_NARRATION_VIDEO_MODES = ["pip", "split", "fullscreen"] as const;
export const LOGO_PLACEMENTS = ["top_left", "top_right", "bottom_left", "bottom_right"] as const;
export const BACKGROUND_TRACKS = MUSIC_PRESET_IDS;
export const VIDEO_ORIENTATIONS = ["horizontal", "vertical"] as const;

/** Local limits. The real product caps these per plan (REPORT.md section 8). */
export const DURATION_LIMITS = { minSeconds: 15, maxSeconds: 900 } as const;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // v1 upload-file cap from the docs.

export const SCENE_PREPARATION_DEFAULTS = [
  "Open with the core idea",
  "Explain the mechanism step by step",
  "Close with the takeaway",
];
