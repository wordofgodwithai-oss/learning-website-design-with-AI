/**
 * Style, language and voice catalogues.
 *
 * Style names are taken verbatim from REPORT.md section 2 (`use_2_0_style`,
 * `image_style`, `pen_style` values). Languages come from the "45+ languages"
 * claim on the pricing page. Voice display names are NOT observable from the
 * bundle — the values below are local stand-ins that keep the same shape.
 */

export const CANVAS_STYLES = [
  "chalkboard_white",
  "chalkboard_black_on_white",
  "neon",
  "whiteboard",
  "modern_minimal",
  "playful",
  "technical",
  "editorial",
  "marker",
  "vox",
] as const;

export const CANVAS_STYLE_VARIANTS = ["compact", "expanded", "legacy"] as const;

export const IMAGE_GENERATION_MODELS = ["default", "illustration", "lineart"] as const;

export const SKETCH_STYLES = [
  "classic",
  "improved",
  "dry erase",
  "professional clean",
  "crayon",
  "infographics",
  "creative",
  "chalkboard_black_on_white",
] as const;

export const PEN_STYLES = ["classic", "pen_in_hand", "formal"] as const;

export const PACING = ["slow", "normal", "fast"] as const;

export const TIMING = ["auto", "scene_by_scene", "narrator_led"] as const;

export interface Language {
  code: string;
  name: string;
}

export const LANGUAGES: Language[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "pt", name: "Portuguese" },
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
  { code: "pl", name: "Polish" },
  { code: "tr", name: "Turkish" },
  { code: "ru", name: "Russian" },
  { code: "uk", name: "Ukrainian" },
  { code: "ar", name: "Arabic" },
  { code: "he", name: "Hebrew" },
  { code: "fa", name: "Persian" },
  { code: "hi", name: "Hindi" },
  { code: "bn", name: "Bengali" },
  { code: "ur", name: "Urdu" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "mr", name: "Marathi" },
  { code: "gu", name: "Gujarati" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "pa", name: "Punjabi" },
  { code: "id", name: "Indonesian" },
  { code: "ms", name: "Malay" },
  { code: "th", name: "Thai" },
  { code: "vi", name: "Vietnamese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh-CN", name: "Chinese (Simplified)" },
  { code: "zh-TW", name: "Chinese (Traditional)" },
  { code: "sv", name: "Swedish" },
  { code: "no", name: "Norwegian" },
  { code: "da", name: "Danish" },
  { code: "fi", name: "Finnish" },
  { code: "cs", name: "Czech" },
  { code: "sk", name: "Slovak" },
  { code: "hu", name: "Hungarian" },
  { code: "ro", name: "Romanian" },
  { code: "bg", name: "Bulgarian" },
  { code: "el", name: "Greek" },
  { code: "sr", name: "Serbian" },
  { code: "hr", name: "Croatian" },
  { code: "sl", name: "Slovenian" },
  { code: "lt", name: "Lithuanian" },
  { code: "lv", name: "Latvian" },
  { code: "et", name: "Estonian" },
  { code: "sw", name: "Swahili" },
  { code: "fil", name: "Filipino" },
];

export function languageName(code: string): string {
  return LANGUAGES.find((language) => language.code === code)?.name ?? "English";
}

export interface Voice {
  id: string;
  name: string;
  gender: "female" | "male" | "neutral";
  accent: string;
}

export const VOICES: Voice[] = [
  { id: "ava", name: "Ava", gender: "female", accent: "American" },
  { id: "noah", name: "Noah", gender: "male", accent: "American" },
  { id: "isla", name: "Isla", gender: "female", accent: "British" },
  { id: "oliver", name: "Oliver", gender: "male", accent: "British" },
  { id: "maya", name: "Maya", gender: "female", accent: "Indian" },
  { id: "luca", name: "Luca", gender: "male", accent: "Italian" },
  { id: "sora", name: "Sora", gender: "neutral", accent: "Japanese" },
  { id: "amara", name: "Amara", gender: "female", accent: "Nigerian" },
];

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
export const BACKGROUND_TRACKS = ["none", "calm", "upbeat", "cinematic", "lofi"] as const;
export const VIDEO_ORIENTATIONS = ["16:9", "9:16", "1:1"] as const;

/** Local limits. The real product caps these per plan (REPORT.md section 8). */
export const DURATION_LIMITS = { minSeconds: 15, maxSeconds: 900 } as const;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // v1 upload-file cap from the docs.

export const SCENE_PREPARATION_DEFAULTS = [
  "Open with the core idea",
  "Explain the mechanism step by step",
  "Close with the takeaway",
];
