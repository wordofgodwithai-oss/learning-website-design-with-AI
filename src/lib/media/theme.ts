import type { Orientation, RenderSettings, Video } from "@/lib/types";

/**
 * Visual identity of the two Golpo render engines.
 *
 * - `golpo_canvas` is the illustrated engine: saturated gradients, flat shapes,
 *   bold accent washes and a modern typeface.
 * - `golpo_sketch` is the line-art engine: paper, grain, marker strokes and a
 *   visible pen cursor while the drawing is revealed.
 *
 * Every knob a request can set (style, colour, engine, orientation) resolves
 * through this module so the renderer never hard-codes a look.
 */

export interface SceneTheme {
  engine: "golpo_canvas" | "golpo_sketch";
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
  // Golpo Canvas
  chalkboard_white: { bg: "#0f2b26", bg2: "#17403a", accent: "#7ff2c0", ink: "#f4fffb" },
  chalkboard_black_on_white: { bg: "#f7f4ec", bg2: "#e6e0d4", accent: "#1c1c1c", ink: "#1c1c1c" },
  neon: { bg: "#0b0620", bg2: "#25124d", accent: "#63f5ff", ink: "#f6f0ff" },
  whiteboard: { bg: "#eef2f7", bg2: "#dbe4ee", accent: "#2563eb", ink: "#16233b" },
  modern_minimal: { bg: "#111318", bg2: "#1c2029", accent: "#c7d2fe", ink: "#f5f6fa" },
  playful: { bg: "#fff1e6", bg2: "#ffe0c7", accent: "#f97316", ink: "#3b1d09" },
  technical: { bg: "#0b1220", bg2: "#12203a", accent: "#38bdf8", ink: "#e6f4ff" },
  editorial: { bg: "#f5f1ea", bg2: "#e7dfd2", accent: "#b45309", ink: "#221a12", font: SERIF_FONT },
  marker: { bg: "#fff7d6", bg2: "#ffe9a8", accent: "#d97706", ink: "#3b2a05" },
  vox: { bg: "#101014", bg2: "#1d1d24", accent: "#f43f5e", ink: "#f7f7fb" },

  // Golpo Sketch
  classic: { bg: "#fbfaf6", bg2: "#f2efe7", accent: "#1f2937", ink: "#1f2937", sketchy: true, grain: 0.16 },
  improved: { bg: "#fcfcfb", bg2: "#f4f4f0", accent: "#0f172a", ink: "#0f172a", sketchy: true, grain: 0.1 },
  "dry erase": { bg: "#f8fafc", bg2: "#eef2f6", accent: "#334155", ink: "#1e293b", sketchy: true, grain: 0.12 },
  "professional clean": { bg: "#ffffff", bg2: "#f1f5f9", accent: "#2563eb", ink: "#0f172a", sketchy: true, grain: 0.06 },
  crayon: { bg: "#fffbe8", bg2: "#ffe9c9", accent: "#ea580c", ink: "#4a2408", sketchy: true, grain: 0.2 },
  infographics: { bg: "#08111f", bg2: "#10233d", accent: "#22d3ee", ink: "#e6fbff", sketchy: true, grain: 0.1 },
  creative: { bg: "#1a0b2e", bg2: "#2d1450", accent: "#f0abfc", ink: "#fdf4ff", sketchy: true, grain: 0.1 },
};

const FALLBACK: Palette = { bg: "#0b1120", bg2: "#16233b", accent: "#7dd3fc", ink: "#f8fafc" };

/**
 * Style names arrive in several spellings (`playful`, `Playful`, `dry erase`,
 * `dry_erase`, `playful_compact`, `classic_legacy`). Folding them to one key
 * means every variant still picks its palette instead of the fallback.
 */
function styleKey(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+(compact|expanded|legacy)$/, "");
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
  settings: Pick<RenderSettings, "engine" | "style" | "useColor">,
): SceneTheme {
  const base = STYLE_LOOKUP.get(styleKey(settings.style)) ?? FALLBACK;
  const palette = settings.useColor ? base : monochrome(base);
  const sketch = settings.engine === "golpo_sketch" || Boolean(palette.sketchy);
  const ink = palette.ink ?? (isLight(palette.bg) ? "#1f2937" : "#f8fafc");

  return {
    engine: sketch ? "golpo_sketch" : "golpo_canvas",
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
    penCursor: sketch,
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
