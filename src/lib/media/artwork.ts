import "server-only";

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import {
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_AI_TOKEN,
  CLOUDFLARE_IMAGE_MODEL,
  IMAGE_TIMEOUT_MS,
  POLLINATIONS_BASE_URL,
  POLLINATIONS_INTERVAL_MS,
  imageMode,
} from "@/lib/integrations";
import { MEDIA_DIR } from "@/lib/media/store";
import type { Engine } from "@/lib/types";

/**
 * Scene artwork.
 *
 * Golpo illustrates each scene; the clone can now do the same through free
 * providers:
 *
 * - Cloudflare Workers AI (`@cf/black-forest-labs/flux-1-schnell`) — 10,000
 *   free neurons/day, roughly 100 images, no card required.
 * - Pollinations — no account at all, but one image per 45 s per IP.
 *
 * Both are optional. Without them (GOLPO_IMAGE_MODE=off, or a failed request)
 * the caller falls back to the vector doodles in `illustration.ts`, so a render
 * never fails because of the art provider.
 */

export interface ArtworkRequest {
  /** Scene visual description + narration, used to build the prompt. */
  description: string;
  style: string;
  engine: Engine;
  useColor: boolean;
  seed: number;
  width: number;
  height: number;
  /** Saved characters that must stay visually consistent across scenes. */
  characters?: Array<{ name: string; description: string }>;
  /** v2 `image_generation_model`; mapped onto the provider's model list. */
  model?: string;
}

const ART_DIR = path.join(MEDIA_DIR, "art");
const REQUEST_GAP_MS = 900;

let queue: Promise<unknown> = Promise.resolve();
let lastPollinationsAt = 0;
let disabledUntil = 0;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function cleanDescription(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/["'`]/g, "")
    .trim()
    .slice(0, 320);
}

const STYLE_HINTS: Record<string, string> = {
  chalkboard_white: "soft chalk drawing on a dark green chalkboard",
  chalkboard_black_on_white: "black chalk marker drawing on white paper",
  neon: "glowing neon line art on a dark background",
  whiteboard: "clean whiteboard marker drawing",
  modern_minimal: "ultra-minimal flat shapes with lots of negative space",
  playful: "cheerful rounded shapes with warm candy colours",
  technical: "precise blueprint-style diagram with thin measured lines",
  editorial: "warm editorial collage with textured paper shapes",
  marker: "bold marker illustration with visible strokes",
  vox: "dramatic editorial illustration with strong contrast",
  classic: "classic hand-drawn sketch with pencil shading",
  improved: "refined hand-drawn sketch with smooth confident lines",
  "dry erase": "dry-erase marker drawing on a whiteboard",
  "professional clean": "clean professional line drawing with one accent colour",
  crayon: "waxy crayon drawing with textured strokes",
  infographics: "dark infographic illustration with glowing data shapes",
  creative: "expressive creative illustration with layered textures",
};

function styleHint(style: string): string {
  const key = (style || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+(compact|expanded|legacy)$/, "");
  return STYLE_HINTS[key] ?? "";
}

export function buildArtworkPrompt(request: ArtworkRequest): string {
  const subject = cleanDescription(request.description) || "an educational concept";
  const hint = styleHint(request.style);
  const cast = (request.characters ?? [])
    .filter((character) => character.name || character.description)
    .slice(0, 4)
    .map((character) =>
      cleanDescription(
        [character.name, character.description].filter(Boolean).join(": "),
      ).slice(0, 140),
    );
  const castLine = cast.length
    ? ` Keep the recurring characters consistent with these descriptions: ${cast.join("; ")}.`
    : "";

  if (request.engine === "golpo_sketch") {
    const color = request.useColor
      ? "one accent colour only, otherwise black ink"
      : "pure black ink, monochrome";
    return (
      `Hand-drawn whiteboard illustration of ${subject}. ` +
      `${hint ? `${hint[0].toUpperCase()}${hint.slice(1)}, ` : ""}` +
      `simple marker line art on a clean white background, ${color}, ` +
      `thick confident strokes, minimal composition, generous empty space, ` +
      `friendly explainer-video doodle, no text, no letters, no numbers, centered.` +
      castLine
    );
  }
  if (request.engine === "golpo_studio") {
    // Studio styles are motion-graphics whiteboard looks: bolder shapes and a
    // tighter palette than Canvas, but still drawn rather than photographic.
    return (
      `Bold motion-graphics whiteboard illustration of ${subject}. ` +
      `${hint ? `${hint[0].toUpperCase()}${hint.slice(1)}, ` : ""}` +
      `thick marker outlines with flat colour fills, strong contrast, ` +
      `minimal background, dynamic explainer-video composition, centered, ` +
      `no text, no letters, no numbers, no watermark.` +
      castLine
    );
  }
  return (
    `Flat vector illustration of ${subject}. ` +
    `${hint ? `${hint[0].toUpperCase()}${hint.slice(1)}, ` : ""}` +
    `bold geometric shapes, limited three-colour palette, soft gradient background, ` +
    `clean modern explainer-video art, centered composition, ` +
    `no text, no letters, no numbers, no watermark.` +
    castLine
  );
}

function normaliseBase64(value: string): string {
  return value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value;
}

async function cloudflareImage(prompt: string, seed: number): Promise<Buffer | null> {
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_AI_TOKEN) return null;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${CLOUDFLARE_IMAGE_MODEL}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${CLOUDFLARE_AI_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ prompt, steps: 8, seed }),
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`cloudflare ${response.status}: ${(await response.text()).slice(0, 180)}`);
  }
  const data = (await response.json()) as {
    success?: boolean;
    result?: { image?: string };
    errors?: Array<{ message?: string }>;
  };
  const image = data.result?.image;
  if (!image) {
    throw new Error(data.errors?.[0]?.message ?? "cloudflare returned no image");
  }
  return Buffer.from(normaliseBase64(image), "base64");
}

async function pollinationsImage(
  prompt: string,
  seed: number,
  width: number,
  height: number,
  model: string,
): Promise<Buffer | null> {
  const now = Date.now();
  if (now < disabledUntil) return null;
  const wait = lastPollinationsAt + POLLINATIONS_INTERVAL_MS - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastPollinationsAt = Date.now();

  const url = new URL(`${POLLINATIONS_BASE_URL.replace(/\/+$/, "")}/prompt/${encodeURIComponent(prompt)}`);
  url.searchParams.set("width", String(Math.min(1024, width)));
  url.searchParams.set("height", String(Math.min(1024, height)));
  url.searchParams.set("model", model);
  url.searchParams.set("seed", String(seed));
  url.searchParams.set("nologo", "true");
  url.searchParams.set("private", "true");
  url.searchParams.set("enhance", "false");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      // A 5xx is usually transient. Wait out another throttle slot before the
      // single retry rather than letting one bad response drop the scene to
      // the doodle fallback.
      const pause = lastPollinationsAt + POLLINATIONS_INTERVAL_MS - Date.now();
      if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
      lastPollinationsAt = Date.now();
    }

    const response = await fetch(url, {
      headers: { accept: "image/jpeg,image/png" },
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
    if (response.status === 402 || response.status === 429) {
      // Free slot exhausted; stop hammering for a while.
      disabledUntil = Date.now() + 120_000;
      return null;
    }
    if (response.status >= 500 && attempt === 0) {
      console.warn(`[artwork] pollinations ${response.status}; retrying once`);
      continue;
    }
    if (!response.ok) {
      throw new Error(`pollinations ${response.status}: ${(await response.text()).slice(0, 180)}`);
    }
    const type = response.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) {
      throw new Error(`pollinations returned ${type || "no content type"}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  return null;
}

/**
 * Maps the v2 `image_generation_model` onto the free provider's catalogue.
 * Cloudflare serves one configured FLUX model, so only Pollinations gets a
 * choice; unknown names fall back to FLUX rather than failing the render.
 */
function providerModel(requested: string | undefined): string {
  const key = (requested ?? "").trim().toLowerCase();
  if (!key || key === "default" || key === "flux" || key.includes("schnell")) return "flux";
  if (key.includes("turbo") || key.includes("sdxl") || key === "sd") return "turbo";
  return "flux";
}

async function rawImage(
  prompt: string,
  seed: number,
  width: number,
  height: number,
  model: string,
): Promise<Buffer | null> {
  if (imageMode === "cloudflare") return cloudflareImage(prompt, seed);
  if (imageMode === "pollinations") return pollinationsImage(prompt, seed, width, height, model);
  return null;
}

/** Serialises provider calls so a job never opens a dozen sockets at once. */
function serialise<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function postProcess(
  source: Buffer,
  request: ArtworkRequest,
  file: string,
): Promise<string> {
  let pipeline = sharp(source).rotate();
  const meta = await pipeline.metadata();
  const targetWidth = Math.max(320, Math.round(request.width));
  const targetHeight = Math.max(240, Math.round(request.height));
  pipeline = pipeline.resize(targetWidth, targetHeight, { fit: "cover", position: "centre" });

  if (request.engine === "golpo_sketch") {
    // Push generated art towards paper-and-ink so it sits next to the vector
    // doodles instead of looking like a pasted photo.
    pipeline = pipeline.normalise().linear(1.12, -14);
    if (!request.useColor) pipeline = pipeline.grayscale().threshold(170);
  } else if (request.engine === "golpo_studio") {
    // Studio keeps colour but wants punchier contrast than a source render.
    pipeline = pipeline.normalise().linear(1.06, -6);
  }
  void meta;

  await pipeline.jpeg({ quality: 88, mozjpeg: true }).toFile(file);
  return file;
}

export interface ArtworkResult {
  /** Absolute path to a cached JPEG, or null when no provider produced one. */
  file: string | null;
  /** `data:image/jpeg;base64,…` for direct embedding in SVG. */
  dataUrl: string | null;
  provider: "cloudflare" | "pollinations" | "cache" | "none";
  prompt: string;
}

export async function generateArtwork(request: ArtworkRequest): Promise<ArtworkResult> {
  const prompt = buildArtworkPrompt(request);
  const model = providerModel(request.model);
  const key = sha256(
    [
      imageMode,
      model,
      prompt,
      String(request.width),
      String(request.height),
      String(request.useColor),
    ].join("|"),
  );
  await fs.mkdir(ART_DIR, { recursive: true });
  const file = path.join(ART_DIR, `${key}.jpg`);

  try {
    const stat = await fs.stat(file);
    if (stat.isFile() && stat.size > 1024) {
      const bytes = await fs.readFile(file);
      return {
        file,
        dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
        provider: "cache",
        prompt,
      };
    }
  } catch {
    // not cached yet
  }

  if (imageMode === "off") return { file: null, dataUrl: null, provider: "none", prompt };

  try {
    const bytes = await serialise(async () => {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
      return rawImage(prompt, request.seed, request.width, request.height, model);
    });
    if (!bytes) return { file: null, dataUrl: null, provider: "none", prompt };

    await postProcess(bytes, request, file);
    const processed = await fs.readFile(file);
    return {
      file,
      dataUrl: `data:image/jpeg;base64,${processed.toString("base64")}`,
      provider: imageMode === "cloudflare" ? "cloudflare" : "pollinations",
      prompt,
    };
  } catch (error) {
    console.warn(
      `[artwork] ${imageMode} failed, using vector doodles: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { file: null, dataUrl: null, provider: "none", prompt };
  }
}

/** Reads an uploaded image (logo, avatar, user photo) as a data URI. */
export async function imageDataUrl(filePath: string | null): Promise<string | null> {
  if (!filePath) return null;
  try {
    const bytes = await fs.readFile(filePath);
    const meta = await sharp(bytes).metadata();
    const type = meta.format === "png" ? "png" : meta.format === "webp" ? "webp" : "jpeg";
    return `data:image/${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
