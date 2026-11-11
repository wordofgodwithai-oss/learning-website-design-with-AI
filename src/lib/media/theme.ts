import type { Engine, Orientation, RenderSettings, Video } from "@/lib/types";

/**
 * Visual identity of the three Golpo render engines.
 *
 * - `golpo_canvas` is the pen-and-ink illustration engine: chalkboards,
 *   whiteboards, Sharpie and colour illustration, with optional pen-in-hand.
 * - `golpo_studio` is the motion whiteboard engine (2 credits/min): marker and
 *   sketch looks that animate on top of the same illustration pipeline.
 * - `golpo_sketch` is the line-art engine: paper, grain, marker strokes.
 *
 * Every palette below is named after the real catalogue entry it renders
 * (`docs/forensics/live/audit-notes.txt` §STYLE CATALOGUES), so a request for
 * `sharpie` or `neon_blackboard` lands on the same look the product previews.
 */

export interface SceneTheme {
  engine: Engine;
  bg: string;
  bg2: string;
  accent: string;
  ink: string;
  softInk: string;
  panelFill: string;
  panelStroke: string;
  grainOpacity: number;
  headingFont: string;
  bodyFont: string;
  strokeScale: number;
  penCursor: boolean;
  paperTooth: boolean;
  /** 0 = flat fills, 1 = sketchy outline-only illustration. */
  sketchiness: number;
}

const HAND_FONT =
  "'Segoe Print', 'Ink Free', 'Comic Sans MS', 'Bradley Hand', 'Segoe Script', Arial, Helvetica, sans-serif";
const CLEAN_FONT = "'Segoe UI Semibold', 'Segoe UI', Inter, Arial, Helvetica, sans-serif";
const SERIF_FONT = "Georgia, 'Times New Roman', serif";

type Palette = {
  bg: string;
  bg2: string;
  accent: string;
  ink?: string;
  sketchy?: boolean;
  grain?: number;
  font?: string;
};

const PALETTES: Record<string, Palette> = {
  // --- Golpo Canvas (11) ---------------------------------------------------
  chalkboard_white_on_black: {
    bg: "#141414",
    bg2: "#1e1e1e",
    accent: "#f2f0e6",
    ink: "#f8f6ee",
    sketchy: true,
    grain: 0.18,
  },
  chalkboard_black_on_white: {
    bg: "#ffffff",
    bg2: "#f4f4f1",
    accent: "#111111",
    ink: "#111111",
    sketchy: true,
    grain: 0.07,
  },
  chalkboard_color: {
    bg: "#173b34",
    bg2: "#1f4c43",
    accent: "#fbbf24",
    ink: "#f7fbf8",
    sketchy: true,
    grain: 0.16,
  },
  whiteboard: {
    bg: "#ffffff",
    bg2: "#f1f5f9",
    accent: "#1d4ed8",
    ink: "#111827",
    sketchy: true,
    grain: 0.06,
  },
  modern_minimal: {
    bg: "#fafafa",
    bg2: "#efefed",
    accent: "#111827",
    ink: "#18181b",
    font: CLEAN_FONT,
  },
  playful: {
    bg: "#fff7ec",
    bg2: "#ffe6cc",
    accent: "#f97316",
    ink: "#2a1a0b",
    sketchy: true,
    grain: 0.12,
  },
  technical: {
    bg: "#ffffff",
    bg2: "#eef4fb",
    accent: "#1d4ed8",
    ink: "#0f172a",
    font: CLEAN_FONT,
  },
  editorial: {
    bg: "#fbf7f0",
    bg2: "#efe7da",
    accent: "#9a3412",
    ink: "#1f1a14",
    font: SERIF_FONT,
  },
  sharpie: {
    bg: "#ffffff",
    bg2: "#f6f6f3",
    accent: "#111111",
    ink: "#111111",
    sketchy: true,
    grain: 0.05,
  },
  illustration: {
    bg: "#fffdf7",
    bg2: "#fdeedb",
    accent: "#ea580c",
    ink: "#2b1a0c",
    sketchy: true,
    grain: 0.08,
  },
  notebook: {
    bg: "#fdfdf8",
    bg2: "#eef3fb",
    accent: "#2563eb",
    ink: "#1e293b",
    sketchy: true,
    grain: 0.07,
  },

  // --- Golpo Sketch (11) ---------------------------------------------------
  classic: { bg: "#fcfcf9", bg2: "#f3f2ea", accent: "#1f2937", ink: "#1f2937", sketchy: true, grain: 0.14 },
  classic_with_words: {
    bg: "#fdfcf7",
    bg2: "#f5f3ea",
    accent: "#111827",
    ink: "#111827",
    sketchy: true,
    grain: 0.12,
  },
  improved: { bg: "#fcfcfb", bg2: "#f4f4f0", accent: "#0f172a", ink: "#0f172a", sketchy: true, grain: 0.09 },
  dry_erase: { bg: "#f8fafc", bg2: "#eef2f6", accent: "#334155", ink: "#1e293b", sketchy: true, grain: 0.1 },
  professional_clean: {
    bg: "#ffffff",
    bg2: "#f1f5f9",
    accent: "#2563eb",
    ink: "#0f172a",
    sketchy: true,
    grain: 0.05,
  },
  crayon: { bg: "#fffbe8", bg2: "#ffe8c4", accent: "#ea580c", ink: "#4a2408", sketchy: true, grain: 0.2 },
  infographics: {
    bg: "#f7fbff",
    bg2: "#e6f1fb",
    accent: "#0891b2",
    ink: "#0f2536",
    sketchy: true,
    grain: 0.06,
  },
  creative: {
    bg: "#fffdf9",
    bg2: "#fbeed9",
    accent: "#7c3aed",
    ink: "#1f1235",
    sketchy: true,
    grain: 0.08,
  },
  formal: {
    bg: "#fbfbfa",
    bg2: "#eef1f5",
    accent: "#1e3a8a",
    ink: "#111827",
    sketchy: true,
    grain: 0.05,
  },
  formal_legacy: {
    bg: "#fbfaf6",
    bg2: "#efece2",
    accent: "#1f2937",
    ink: "#1f2937",
    sketchy: true,
    grain: 0.1,
  },

  // --- Golpo Studio (11) ---------------------------------------------------
  colorful_sketch: {
    bg: "#fffdf8",
    bg2: "#fdeed6",
    accent: "#f97316",
    ink: "#2a1a0b",
    sketchy: true,
    grain: 0.1,
  },
  khan_academy: {
    bg: "#f9fbf5",
    bg2: "#eaf4e3",
    accent: "#15803d",
    ink: "#14291a",
    sketchy: true,
    grain: 0.08,
  },
  chalkboard: {
    bg: "#14231f",
    bg2: "#1d312b",
    accent: "#f4f1e6",
    ink: "#f7f5ed",
    sketchy: true,
    grain: 0.16,
  },
  bold_marker: {
    bg: "#ffffff",
    bg2: "#f4f4f2",
    accent: "#111111",
    ink: "#111111",
    sketchy: true,
    grain: 0.05,
  },
  simple_sketch: {
    bg: "#fbfbf9",
    bg2: "#f2f2ee",
    accent: "#374151",
    ink: "#1f2937",
    sketchy: true,
    grain: 0.1,
  },
  marker_cartoon: {
    bg: "#fff8ec",
    bg2: "#ffe7c9",
    accent: "#e11d48",
    ink: "#2c1706",
    sketchy: true,
    grain: 0.12,
  },
  brightboard: {
    bg: "#ffffff",
    bg2: "#eef6ff",
    accent: "#0ea5e9",
    ink: "#0b2233",
    sketchy: true,
    grain: 0.05,
  },
  neon_blackboard: {
    bg: "#0b0f1a",
    bg2: "#141c2b",
    accent: "#22d3ee",
    ink: "#f2fbff",
    sketchy: true,
    grain: 0.14,
  },
  expressive_editorial_marker: {
    bg: "#faf6ee",
    bg2: "#f0e5d2",
    accent: "#b91c1c",
    ink: "#231a12",
    sketchy: true,
    grain: 0.1,
  },
  signature_whiteboard: {
    bg: "#ffffff",
    bg2: "#f0f4f8",
    accent: "#0f4c81",
    ink: "#0f172a",
    sketchy: true,
    grain: 0.05,
  },
};

const FALLBACK: Palette = { bg: "#0b1120", bg2: "#16233b", accent: "#7dd3fc", ink: "#f8fafc" };

/**
 * Style names arrive in several spellings (`playful`, `Playful`, `dry erase`,
 * `dry_erase`, `Chalkboard (White on Black)`, `chalkboard_white_on_black`).
 * Folding punctuation and separators to one key means every variant still
 * picks its palette instead of the fallback.
 */
function styleKey(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+(compact|expanded)$/, "")
    .trim();
}

const STYLE_LOOKUP = new Map(
  Object.entries(PALETTES).map(([name, palette]) => [styleKey(name), palette]),
);

function monochrome(palette: Palette): Palette {
  const dark = palette.bg.startsWith("#0") || palette.bg.startsWith("#1") || palette.bg.startsWith("#2");
  return {
    bg: dark ? "#141414" : "#f6f6f4",
    bg2: dark ? "#1f1f1f" : "#ebebe8",
    accent: dark ? "#e5e5e5" : "#1a1a1a",
    ink: dark ? "#f5f5f5" : "#141414",
    sketchy: palette.sketchy,
    grain: palette.grain,
    font: palette.font,
  };
}

export function resolveTheme(
  settings: Pick<RenderSettings, "engine" | "style" | "useColor"> & {
    penAnimationStyle?: string | null;
  },
): SceneTheme {
  const base = STYLE_LOOKUP.get(styleKey(settings.style)) ?? FALLBACK;
  const palette = settings.useColor ? base : monochrome(base);
  // Studio and Sketch are hand-drawn at heart; Canvas is too whenever the
  // chosen style is a chalkboard/whiteboard/marker look rather than a clean
  // minimal one.
  const sketch = settings.engine !== "golpo_canvas" || Boolean(palette.sketchy);
  const ink = palette.ink ?? (isLight(palette.bg) ? "#1f2937" : "#f8fafc");
  const penTool = (settings.penAnimationStyle ?? "").trim().toLowerCase();
  const showPen = penTool === "stylus" || penTool === "marker" || penTool === "pen";

  return {
    engine: settings.engine,
    bg: palette.bg,
    bg2: palette.bg2,
    accent: palette.accent,
    ink,
    softInk: isLight(palette.bg) ? "#6b7280" : "#cbd5e1",
    panelFill: isLight(palette.bg) ? "#ffffff" : "rgba(255,255,255,0.045)",
    panelStroke: ink,
    grainOpacity: palette.grain ?? (sketch ? 0.14 : 0.05),
    headingFont: palette.font ?? (sketch ? HAND_FONT : CLEAN_FONT),
    bodyFont: sketch ? HAND_FONT : CLEAN_FONT,
    strokeScale: sketch ? 1.15 : 1,
    penCursor: showPen,
    paperTooth: sketch,
    sketchiness: sketch ? 1 : 0,
  };
}

function isLight(hex: string): boolean {
  const value = hex.replace("#", "");
  if (value.length !== 6) return false;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

// ---------------------------------------------------------------------------
// Orientation + layout
// ---------------------------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  width: number;
  height: number;
  portrait: boolean;
  square: boolean;
  padding: number;
  header: Box;
  art: Box;
  narration: Box;
  caption: Box;
  footer: Box;
  progress: Box;
  /** Where a presenter avatar sits, when one is requested. */
  presenter: Box;
  narrationFont: number;
  narrationLineHeight: number;
  narrationChars: number;
  narrationLines: number;
  titleFont: number;
  titleChars: number;
  titleLines: number;
}

export const ORIENTATION_SIZES: Record<Orientation, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 900, height: 900 },
};

export function normaliseOrientation(value: string | null | undefined): Orientation {
  if (value === "9:16" || value === "1:1") return value;
  return "16:9";
}

export function layoutFor(orientation: Orientation): Layout {
  const { width, height } = ORIENTATION_SIZES[orientation];

  if (orientation === "9:16") {
    return {
      width,
      height,
      portrait: true,
      square: false,
      padding: 56,
      header: { x: 56, y: 44, width: width - 112, height: 52 },
      art: { x: 52, y: 116, width: width - 104, height: 560 },
      narration: { x: 62, y: 722, width: width - 124, height: 430 },
      caption: { x: 62, y: 664, width: width - 124, height: 52 },
      footer: { x: 62, y: height - 92, width: width - 124, height: 44 },
      progress: { x: 62, y: height - 138, width: width - 124, height: 8 },
      presenter: { x: width - 214, y: height - 344, width: 156, height: 196 },
      narrationFont: 38,
      narrationLineHeight: 56,
      narrationChars: 23,
      narrationLines: 7,
      titleFont: 50,
      titleChars: 20,
      titleLines: 3,
    };
  }

  if (orientation === "1:1") {
    return {
      width,
      height,
      portrait: false,
      square: true,
      padding: 56,
      header: { x: 56, y: 38, width: width - 112, height: 46 },
      art: { x: 54, y: 108, width: width - 108, height: 470 },
      narration: { x: 66, y: 620, width: width - 132, height: 200 },
      caption: { x: 66, y: 578, width: width - 132, height: 36 },
      footer: { x: 66, y: height - 64, width: width - 132, height: 32 },
      progress: { x: 66, y: height - 96, width: width - 132, height: 7 },
      presenter: { x: width - 208, y: 140, width: 136, height: 172 },
      narrationFont: 31,
      narrationLineHeight: 44,
      narrationChars: 38,
      narrationLines: 4,
      titleFont: 44,
      titleChars: 24,
      titleLines: 3,
    };
  }

  return {
    width,
    height,
    portrait: false,
    square: false,
    padding: 64,
    header: { x: 64, y: 40, width: width - 128, height: 52 },
    art: { x: 664, y: 124, width: width - 664 - 64, height: 462 },
    narration: { x: 78, y: 186, width: 548, height: 400 },
    caption: { x: 664, y: 600, width: width - 728, height: 44 },
    footer: { x: 78, y: height - 66, width: width - 156, height: 34 },
    progress: { x: 78, y: height - 100, width: width - 156, height: 7 },
    presenter: { x: width - 248, y: height - 330, width: 172, height: 212 },
    narrationFont: 34,
    narrationLineHeight: 50,
    narrationChars: 28,
    narrationLines: 7,
    titleFont: 46,
    titleChars: 26,
    titleLines: 2,
  };
}

export function settingsFor(video: Video): RenderSettings {
  if (video.render) {
    return {
      ...video.render,
      orientation: normaliseOrientation(video.render.orientation),
    };
  }
  // Rows created before `render` existed fall back to the columns they do have.
  return {
    engine: video.engine,
    style: video.style,
    orientation: "16:9",
    useColor: true,
    pacing: "normal",
    timing: "auto",
    penStyle: video.pen_style,
    imageStyle: video.image_style,
    imageGenerationModel: "default",
    penAnimationStyle: null,
    frameTransition: "none",
    characters: [],
    styleReference: null,
    skipAnimation: false,
    watermark: video.watermark,
    logo: null,
    music: null,
    avatar: null,
    ownNarration: null,
    media: [],
    voice: { name: null, instructions: null },
    scriptSource: null,
  };
}

export function layoutForVideo(video: Video): Layout {
  return layoutFor(settingsFor(video).orientation);
}
