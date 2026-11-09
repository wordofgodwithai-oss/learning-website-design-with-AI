import type { Video } from "@/lib/types";
import { motifLabel, renderDoodles } from "@/lib/media/illustration";
import {
  layoutForVideo,
  resolveTheme,
  settingsFor,
  type Layout,
  type SceneTheme,
} from "@/lib/media/theme";

/**
 * Storyboard and scene frames.
 *
 * One layout engine renders every output the product supports: landscape,
 * portrait and square videos, both render engines, podcasts, presenter
 * avatars, logos, watermarks and user-supplied artwork. Scene frames are
 * rasterised by sharp for the FFmpeg renderer; the same body is reused for the
 * animated SVG storyboard fallback.
 */

const RASTER_FONT = "Arial, Helvetica, sans-serif";

export interface SceneLike {
  narration: string;
  visual: string;
}

export interface FrameExtras {
  /** `data:image/...` artwork for the illustration panel. */
  artwork?: string | null;
  /** `data:image/...` uploaded logo. */
  logoDataUrl?: string | null;
  /** `data:image/...` uploaded avatar (custom presenter). */
  presenterDataUrl?: string | null;
  /** Podcast waveform, 0..1 amplitudes. */
  waveform?: number[] | null;
  /** Podcast chapter / episode label. */
  chapter?: string | null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxChars) {
      if (current) lines.push(current.trim());
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

function withEllipsis(lines: string[], all: string[], maxChars: number, maxLines: number): string[] {
  if (all.length <= maxLines || lines.length === 0) return lines;
  const last = lines[lines.length - 1];
  const trimmed = last.length > maxChars - 1 ? last.slice(0, maxChars - 1) : last;
  return [...lines.slice(0, -1), `${trimmed}…`];
}

function hash(input: string): number {
  let value = 0;
  for (let index = 0; index < input.length; index += 1) {
    value = (value * 31 + input.charCodeAt(index)) >>> 0;
  }
  return value;
}

function rng(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

function background(
  layout: Layout,
  theme: SceneTheme,
  seed: number,
  withDefs: boolean,
): string {
  const { width, height } = layout;
  const defs = withDefs
    ? `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${theme.bg}"/>
      <stop offset="100%" stop-color="${theme.bg2}"/>
    </linearGradient>
    <pattern id="grain" width="26" height="26" patternUnits="userSpaceOnUse">
      <circle cx="3" cy="4" r="1.3" fill="${theme.ink}" opacity="${theme.grainOpacity}"/>
      <circle cx="16" cy="18" r="1" fill="${theme.ink}" opacity="${theme.grainOpacity * 0.7}"/>
      <circle cx="21" cy="7" r="0.8" fill="${theme.ink}" opacity="${theme.grainOpacity * 0.5}"/>
    </pattern>
    <radialGradient id="vignette" cx="50%" cy="45%" r="70%">
      <stop offset="60%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.16"/>
    </radialGradient>
  </defs>`
    : "";

  const wash =
    theme.engine === "golpo_sketch"
      ? `<circle cx="${layout.width * 0.18}" cy="${layout.height * 0.22}" r="${layout.width * 0.3}" fill="${theme.accent}" opacity="0.05"/>
         <path d="M0 ${layout.height * 0.72} C ${layout.width * 0.3} ${layout.height * 0.7}, ${layout.width * 0.66} ${layout.height * 0.76}, ${layout.width} ${layout.height * 0.71}" fill="none" stroke="${theme.ink}" stroke-width="1.5" opacity="0.06"/>`
      : `<circle cx="${layout.width * 0.12}" cy="${layout.height * 0.18}" r="${layout.width * 0.34}" fill="${theme.accent}" opacity="0.09"/>
         <circle cx="${layout.width * 0.96}" cy="${layout.height * 0.9}" r="${layout.width * 0.36}" fill="${theme.accent}" opacity="0.07"/>`;

  return `${defs}
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  ${wash}
  <rect width="${width}" height="${height}" fill="url(#grain)"/>
  <rect width="${width}" height="${height}" fill="url(#vignette)"/>`;
}

// ---------------------------------------------------------------------------
// Branding, logo, watermark
// ---------------------------------------------------------------------------

function brandMark(x: number, y: number, theme: SceneTheme): string {
  return `<g transform="translate(${x} ${y})">
    <path d="M2 30 L22 2 L42 30 Z" fill="${theme.accent}" opacity="0.92"/>
    <path d="M22 8 L32 26 L12 26 Z" fill="${theme.ink}" opacity="0.34"/>
  </g>`;
}

function headerLabel(video: Video, layout: Layout): string {
  if (video.is_audio_only) return "PODCAST";
  return video.engine === "golpo_sketch" ? "SKETCH" : "CANVAS";
}

function headerRow(video: Video, layout: Layout, theme: SceneTheme, index: number, total: number): string {
  const { header } = layout;
  const label = headerLabel(video, layout);
  const brandY = header.y + 4;
  return `${brandMark(header.x, brandY, theme)}
  <text x="${header.x + 58}" y="${header.y + 34}" font-family="${RASTER_FONT}" font-size="${layout.portrait ? 19 : 21}" letter-spacing="3.4" fill="${theme.accent}" opacity="0.92">GOLPO · ${label}</text>
  <text x="${header.x + header.width}" y="${header.y + 34}" text-anchor="end" font-family="${theme.bodyFont}" font-size="${layout.portrait ? 17 : 20}" fill="${theme.ink}" opacity="0.58">${escapeXml(
    `${index + 1} / ${total}`,
  )}</text>
  <path d="M${header.x} ${header.y + header.height - 6} C ${header.x + header.width * 0.32} ${header.y + header.height - 12}, ${header.x + header.width * 0.68} ${header.y + header.height}, ${header.x + header.width} ${header.y + header.height - 8}" fill="none" stroke="${theme.ink}" stroke-width="2.2" opacity="0.24"/>`;
}

function logoLayer(layout: Layout, theme: SceneTheme, logo: string | null | undefined, placement: string): string {
  if (!logo) return "";
  const height = layout.portrait ? 42 : 50;
  const margin = Math.round(layout.padding * 0.7);
  const anchors: Record<string, { x: number; y: number; anchor: string }> = {
    top_left: { x: margin, y: margin, anchor: "start" },
    top_right: { x: layout.width - margin, y: margin, anchor: "end" },
    bottom_left: { x: margin, y: layout.height - margin - height, anchor: "start" },
    bottom_right: { x: layout.width - margin, y: layout.height - margin - height, anchor: "end" },
  };
  const spot = anchors[placement] ?? anchors.top_right;
  const width = height * 3.2;
  const x = spot.anchor === "end" ? spot.x - width : spot.x;
  return `<g opacity="0.94">
    <image href="${logo}" xlink:href="${logo}" x="${x}" y="${spot.y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>
  </g>`;
}

function watermark(layout: Layout, theme: SceneTheme): string {
  const y = layout.height - 14;
  return `<text x="${layout.width - 18}" y="${y}" text-anchor="end" font-family="${RASTER_FONT}" font-size="13" letter-spacing="1.6" fill="${theme.ink}" opacity="0.34">MADE WITH GOLPO</text>`;
}

// ---------------------------------------------------------------------------
// Illustration panel
// ---------------------------------------------------------------------------

function panel(layout: Layout, theme: SceneTheme): string {
  const { art } = layout;
  const wobble = theme.engine === "golpo_sketch" ? 1.6 : 0.6;
  return `<g>
    <rect x="${art.x}" y="${art.y}" width="${art.width}" height="${art.height}" rx="24" fill="${theme.panelFill}"/>
    <rect x="${art.x}" y="${art.y}" width="${art.width}" height="${art.height}" rx="24" fill="none" stroke="${theme.panelStroke}" stroke-width="${theme.engine === "golpo_sketch" ? 3.4 : 2.4}" opacity="0.55"/>
    <rect x="${art.x + 5}" y="${art.y + 4}" width="${art.width - 10}" height="${art.height - 8}" rx="20" fill="none" stroke="${theme.accent}" stroke-width="1.8" opacity="0.4" transform="rotate(-${wobble} ${art.x + art.width / 2} ${art.y + art.height / 2})"/>
  </g>`;
}

function artworkLayer(
  layout: Layout,
  theme: SceneTheme,
  extras: FrameExtras,
  progress: number,
): string {
  const { art } = layout;
  const inset = 16;
  const inner = {
    x: art.x + inset,
    y: art.y + inset,
    width: art.width - inset * 2,
    height: art.height - inset * 2,
  };

  if (extras.waveform && extras.waveform.length > 0) {
    return waveformLayer(inner, theme, extras.waveform, progress, extras.chapter ?? null);
  }

  if (!extras.artwork) return "";

  const reveal = Math.max(0.02, Math.min(1, progress));
  const clipId = `wipe-${Math.round(reveal * 1000)}`;
  return `<defs><clipPath id="${clipId}"><rect x="${inner.x}" y="${inner.y}" width="${(inner.width * reveal).toFixed(1)}" height="${inner.height}"/></clipPath></defs>
  <g clip-path="url(#${clipId})">
    <image href="${extras.artwork}" xlink:href="${extras.artwork}" x="${inner.x}" y="${inner.y}" width="${inner.width}" height="${inner.height}" preserveAspectRatio="xMidYMid slice"/>
  </g>`;
}

function motifLayer(
  layout: Layout,
  theme: SceneTheme,
  scene: SceneLike,
  extras: FrameExtras,
): string {
  const { art } = layout;
  const label = extras.chapter ? extras.chapter.toUpperCase() : motifLabel(`${scene.visual} ${scene.narration}`);
  const fontSize = layout.portrait ? 18 : 20;
  const pillWidth = Math.min(art.width - 40, label.length * fontSize * 0.62 + 28);
  const x = art.x + 18;
  const y = art.y + art.height - 18 - fontSize - 8;
  return `<g opacity="0.96">
    <rect x="${x}" y="${y}" width="${pillWidth.toFixed(0)}" height="${fontSize + 16}" rx="${(fontSize + 16) / 2}" fill="${theme.bg}" opacity="0.82"/>
    <rect x="${x}" y="${y}" width="${pillWidth.toFixed(0)}" height="${fontSize + 16}" rx="${(fontSize + 16) / 2}" fill="none" stroke="${theme.accent}" stroke-width="1.4" opacity="0.5"/>
    <text x="${x + 14}" y="${y + fontSize + 3}" font-family="${theme.bodyFont}" font-size="${fontSize}" font-weight="700" letter-spacing="1" fill="${theme.accent}">${escapeXml(label)}</text>
  </g>`;
}

function waveformLayer(
  box: { x: number; y: number; width: number; height: number },
  theme: SceneTheme,
  values: number[],
  progress: number,
  chapter: string | null,
): string {
  const count = Math.max(12, Math.min(96, values.length));
  const gap = box.width / count;
  const barWidth = Math.max(2, gap * 0.5);
  const middle = box.y + box.height / 2;
  const visible = Math.ceil(count * Math.max(0, Math.min(1, progress)));
  const bars = values
    .slice(0, count)
    .map((value, index) => {
      if (index >= visible) return "";
      const amplitude = Math.max(0.06, Math.min(1, value));
      const height = amplitude * box.height * 0.78;
      return `<rect x="${(box.x + index * gap).toFixed(1)}" y="${(middle - height / 2).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${height.toFixed(1)}" rx="${(barWidth / 2).toFixed(1)}" fill="${theme.accent}" opacity="${(0.45 + amplitude * 0.5).toFixed(2)}"/>`;
    })
    .join("");

  const title = chapter
    ? `<text x="${box.x + box.width / 2}" y="${box.y + box.height * 0.2}" text-anchor="middle" font-family="${theme.bodyFont}" font-size="${Math.round(box.width * 0.05)}" font-weight="700" fill="${theme.ink}">${escapeXml(chapter)}</text>`
    : "";

  return `${title}${bars}`;
}

// ---------------------------------------------------------------------------
// Presenter avatar
// ---------------------------------------------------------------------------

function presenter(
  layout: Layout,
  theme: SceneTheme,
  mode: string,
  imageDataUrl: string | null,
  progress: number,
): string {
  const box = layout.presenter;
  const bob = Math.sin(progress * Math.PI * 2) * 2;
  const cx = box.x + box.width / 2;
  const headRadius = box.width * (mode === "head" ? 0.31 : 0.24);
  const headY = box.y + box.height * (mode === "head" ? 0.38 : 0.3) + bob;
  const heightScale = mode === "head" ? 1.55 : mode === "full_body" ? 0.92 : 1.12;

  if (imageDataUrl) {
    const size = Math.min(box.width, box.height);
    return `<g>
      <circle cx="${cx}" cy="${box.y + size / 2}" r="${size / 2 + 4}" fill="${theme.panelFill}" stroke="${theme.accent}" stroke-width="2.5" opacity="0.95"/>
      <clipPath id="avatarClip"><circle cx="${cx}" cy="${box.y + size / 2}" r="${size / 2}"/></clipPath>
      <image href="${imageDataUrl}" xlink:href="${imageDataUrl}" x="${cx - size / 2}" y="${box.y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>
    </g>`;
  }

  const bodyTop = headY + headRadius * 0.95;
  const bodyHeight = box.height * 0.52 * heightScale;
  const shoulder = box.width * 0.46;

  return `<g>
    <ellipse cx="${cx}" cy="${box.y + box.height - 10}" rx="${box.width * 0.36}" ry="10" fill="${theme.ink}" opacity="0.12"/>
    <path d="M${cx - shoulder} ${bodyTop + bodyHeight} C ${cx - shoulder} ${bodyTop + bodyHeight * 0.32}, ${cx + shoulder} ${bodyTop + bodyHeight * 0.32}, ${cx + shoulder} ${bodyTop + bodyHeight} Z" fill="${theme.accent}" opacity="0.9"/>
    <path d="M${cx - shoulder * 0.42} ${bodyTop + 6} L ${cx} ${bodyTop + bodyHeight * 0.4} L ${cx + shoulder * 0.42} ${bodyTop + 6}" fill="none" stroke="${theme.ink}" stroke-width="2" opacity="0.28"/>
    <circle cx="${cx}" cy="${headY}" r="${headRadius}" fill="${theme.panelFill}" stroke="${theme.ink}" stroke-width="2.4"/>
    <path d="M${cx - headRadius * 0.95} ${headY - headRadius * 0.28} C ${cx - headRadius * 0.7} ${headY - headRadius * 1.28}, ${cx + headRadius * 0.7} ${headY - headRadius * 1.28}, ${cx + headRadius * 0.95} ${headY - headRadius * 0.28}" fill="${theme.ink}" opacity="0.85"/>
    <circle cx="${cx - headRadius * 0.36}" cy="${headY - headRadius * 0.05}" r="${headRadius * 0.09}" fill="${theme.ink}"/>
    <circle cx="${cx + headRadius * 0.36}" cy="${headY - headRadius * 0.05}" r="${headRadius * 0.09}" fill="${theme.ink}"/>
    <path d="M${cx - headRadius * 0.3} ${headY + headRadius * 0.34} Q ${cx} ${headY + headRadius * 0.56} ${cx + headRadius * 0.3} ${headY + headRadius * 0.34}" fill="none" stroke="${theme.ink}" stroke-width="2.2" stroke-linecap="round"/>
  </g>`;
}

// ---------------------------------------------------------------------------
// Text block
// ---------------------------------------------------------------------------

function narrationLayer(
  layout: Layout,
  theme: SceneTheme,
  scene: SceneLike,
  progress: number,
): string {
  const all = wrap(scene.narration, layout.narrationChars);
  const lines = withEllipsis(
    all.slice(0, layout.narrationLines),
    all,
    layout.narrationChars,
    layout.narrationLines,
  );
  const { narration } = layout;
  const textOpacity = Math.max(0.15, Math.min(1, (progress - 0.1) / 0.5));
  return lines
    .map(
      (line, index) =>
        `<text x="${narration.x}" y="${narration.y + index * layout.narrationLineHeight}" font-family="${theme.bodyFont}" font-size="${layout.narrationFont}" font-weight="600" fill="${theme.ink}" opacity="${textOpacity.toFixed(2)}">${escapeXml(line)}</text>`,
    )
    .join("\n  ");
}

function underline(layout: Layout, theme: SceneTheme, scene: SceneLike): string {
  const { narration } = layout;
  const width = Math.min(layout.portrait ? 280 : 300, Math.max(120, scene.narration.length * 4.5));
  const y = narration.y + layout.narrationLines * layout.narrationLineHeight + 8;
  return `<path d="M${narration.x} ${y} C ${narration.x + width * 0.4} ${y - 8}, ${narration.x + width * 0.75} ${y + 6}, ${narration.x + width} ${y - 2}" fill="none" stroke="${theme.accent}" stroke-width="5.5" stroke-linecap="round" opacity="0.82"/>`;
}

function progressBar(layout: Layout, theme: SceneTheme, ratio: number): string {
  const { progress } = layout;
  const width = Math.round(Math.max(0, Math.min(1, ratio)) * progress.width);
  return `<rect x="${progress.x}" y="${progress.y}" width="${progress.width}" height="${progress.height}" rx="${progress.height / 2}" fill="${theme.ink}" opacity="0.13"/>
  <rect x="${progress.x}" y="${progress.y}" width="${width}" height="${progress.height}" rx="${progress.height / 2}" fill="${theme.accent}" opacity="0.92"/>`;
}

function footer(layout: Layout, theme: SceneTheme, video: Video): string {
  const { footer } = layout;
  const pieces = [
    video.style.replace(/_/g, " "),
    video.display_language,
    video.is_audio_only ? "audio · podcast" : `${video.duration_seconds}s`,
  ];
  return `<text x="${footer.x}" y="${footer.y + 22}" font-family="${RASTER_FONT}" font-size="${layout.portrait ? 14 : 16}" letter-spacing="0.6" fill="${theme.ink}" opacity="0.48">${escapeXml(
    pieces.join(" · "),
  )}</text>`;
}

// ---------------------------------------------------------------------------
// Frame assembly
// ---------------------------------------------------------------------------

interface FrameContext {
  video: Video;
  scene: SceneLike;
  index: number;
  total: number;
  progress: number;
  extras: FrameExtras;
  theme: SceneTheme;
  layout: Layout;
  seed: number;
}

function composeFrame(context: FrameContext, withDefs: boolean): string {
  const { video, scene, index, total, progress, extras, theme, layout, seed } = context;
  const settings = settingsFor(video);
  const reveal = Math.max(0.02, Math.min(1, progress));

  const art = artworkLayer(layout, theme, extras, progress);

  const doodles =
    !extras.artwork && !extras.waveform
      ? `<g transform="translate(${layout.art.x + 16} ${layout.art.y + 16})">${renderDoodles({
          text: `${scene.visual} ${scene.narration}`,
          width: layout.art.width - 32,
          height: layout.art.height - 32,
          ink: theme.ink,
          accent: theme.accent,
          seed: seed + index * 7919,
          progress: reveal,
        })}</g>`
      : "";

  const presenterLayer = settings.avatar
    ? presenter(
        layout,
        theme,
        settings.avatar.presentation,
        extras.presenterDataUrl ?? null,
        progress,
      )
    : "";

  const logo = settings.logo
    ? logoLayer(layout, theme, extras.logoDataUrl ?? null, settings.logo.placement)
    : "";

  return `${background(layout, theme, seed, withDefs)}
  ${headerRow(video, layout, theme, index, total)}
  ${panel(layout, theme)}
  ${art}
  ${doodles}
  ${presenterLayer}
  ${motifLayer(layout, theme, scene, extras)}
  ${narrationLayer(layout, theme, scene, progress)}
  ${underline(layout, theme, scene)}
  ${footer(layout, theme, video)}
  ${progressBar(layout, theme, (index + 1) / Math.max(1, total))}
  ${logo}
  ${settings.watermark ? watermark(layout, theme) : ""}`;
}

function seedFor(video: Video): number {
  return hash(video.id);
}

/**
 * One scene frame. `progress` 0..1 drives both the artwork wipe and the
 * text fade so the renderer can emit a short "being drawn" animation.
 */
export function renderSceneFrame(
  video: Video,
  scene: SceneLike,
  index: number,
  total: number,
  progress = 1,
  extras: FrameExtras = {},
): string {
  const layout = layoutForVideo(video);
  const theme = resolveTheme(settingsFor(video));
  const seed = seedFor(video);
  const body = composeFrame(
    { video, scene, index, total, progress, extras, theme, layout, seed },
    true,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">${body}</svg>`;
}

/** Poster frame (first scene, fully revealed). */
export function renderRasterPoster(video: Video, extras: FrameExtras = {}): string {
  const layout = layoutForVideo(video);
  const theme = resolveTheme(settingsFor(video));
  const seed = seedFor(video);
  const first = video.scenes?.[0] ?? { narration: video.title, visual: video.title };
  const scene: SceneLike = { narration: video.title, visual: first.visual ?? video.title };
  const body = composeFrame(
    { video, scene, index: 0, total: video.scenes?.length ?? 1, progress: 1, extras, theme, layout, seed },
    true,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">${body}</svg>`;
}

/** Static SVG poster served by the API when a raster poster is unavailable. */
export function renderPoster(video: Video): string {
  return renderRasterPoster(video);
}

/**
 * Animated SVG storyboard: every scene fades in for its share of the timeline.
 * Used as the fallback when FFmpeg cannot run.
 */
export function renderPreview(video: Video): string {
  const layout = layoutForVideo(video);
  const theme = resolveTheme(settingsFor(video));
  const seed = seedFor(video);
  const scenes = video.scenes?.length
    ? video.scenes
    : [{ index: 0, narration: video.script ?? video.title, visual: video.title, startSeconds: 0 }];
  const perScene = Math.max(2.5, video.duration_seconds / scenes.length);

  const groups = scenes
    .map((scene, index) => {
      const body = composeFrame(
        {
          video,
          scene,
          index,
          total: scenes.length,
          progress: 1,
          extras: {},
          theme,
          layout,
          seed,
        },
        index === 0,
      );
      return `<g opacity="0">
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.06;0.9;1" dur="${perScene.toFixed(2)}s" begin="${(index * perScene).toFixed(2)}s" repeatCount="indefinite"/>
      ${body}
    </g>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="${escapeXml(video.title)}">
  ${groups}
</svg>`;
}
