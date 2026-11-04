import type { Video } from "@/lib/types";

/**
 * Simulated render output.
 *
 * The clone cannot call an image/video vendor, so every finished video is
 * rendered as an animated SVG "storyboard preview" plus a poster. The routes
 * serve them with the same URLs the real product returns
 * (`video_url` / `poster_url`), so replacing this module with a real MP4 is a
 * drop-in change.
 *
 * TODO(REAL-RENDER): return the vendor's MP4 + poster URLs instead.
 */

const PALETTES: Record<string, [string, string, string]> = {
  chalkboard_white: ["#0f2b26", "#17403a", "#7ff2c0"],
  chalkboard_black_on_white: ["#f7f4ec", "#e6e0d4", "#1c1c1c"],
  neon: ["#0b0620", "#25124d", "#63f5ff"],
  whiteboard: ["#eef2f7", "#dbe4ee", "#2563eb"],
  modern_minimal: ["#111318", "#1c2029", "#c7d2fe"],
  playful: ["#fff1e6", "#ffe0c7", "#f97316"],
  technical: ["#0b1220", "#12203a", "#38bdf8"],
  editorial: ["#f5f1ea", "#e7dfd2", "#b45309"],
  marker: ["#fff7d6", "#ffe9a8", "#d97706"],
  vox: ["#101014", "#1d1d24", "#f43f5e"],
  classic: ["#f4f4f5", "#e4e4e7", "#18181b"],
  improved: ["#f8fafc", "#e2e8f0", "#0f172a"],
  "dry erase": ["#f8fafc", "#eef2f6", "#334155"],
  "professional clean": ["#0f172a", "#1e293b", "#60a5fa"],
  crayon: ["#fffbe8", "#ffe9c9", "#ea580c"],
  infographics: ["#08111f", "#10233d", "#22d3ee"],
  creative: ["#1a0b2e", "#2d1450", "#f0abfc"],
};

function hash(input: string): number {
  let value = 0;
  for (let index = 0; index < input.length; index += 1) {
    value = (value * 31 + input.charCodeAt(index)) >>> 0;
  }
  return value;
}

function palette(style: string): [string, string, string] {
  return PALETTES[style] ?? ["#0b1120", "#16233b", "#7dd3fc"];
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

function captionChunks(video: Video): string[] {
  const script = (video.script ?? video.title).replace(/\s+/g, " ").trim();
  const sentences = script.split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (const sentence of sentences) {
    const lines = wrap(sentence, 46);
    for (let index = 0; index < lines.length; index += 2) {
      chunks.push(lines.slice(index, index + 2).join("\n"));
    }
  }
  return chunks.length > 0 ? chunks.slice(0, 8) : [video.title];
}

interface CanvasOptions {
  width?: number;
  height?: number;
}

function frame(video: Video, options: CanvasOptions = {}) {
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const seed = hash(video.id);
  const [bg, bg2, accent] = palette(video.style);
  const ink = bg.startsWith("#f") || bg.startsWith("#e") ? "#1f2937" : "#f8fafc";
  return { width, height, seed, bg, bg2, accent, ink };
}

export function renderPoster(video: Video): string {
  const { width, height, seed, bg, bg2, accent, ink } = frame(video);
  const label = video.is_audio_only ? "PODCAST" : video.engine === "golpo_sketch" ? "SKETCH" : "CANVAS";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(video.title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="${bg2}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <circle cx="${180 + (seed % 400)}" cy="${140 + (seed % 200)}" r="220" fill="${accent}" opacity="0.10"/>
  <circle cx="${width - 160}" cy="${height - 120}" r="300" fill="${accent}" opacity="0.07"/>
  <g transform="translate(72 92)" fill="${accent}">
    <rect x="0" y="0" width="46" height="46" rx="12" fill="${accent}" opacity="0.18"/>
    <path d="M12 32 L22 14 L32 32 Z" fill="${accent}"/>
  </g>
  <text x="132" y="124" font-family="Satoshi, Inter, Segoe UI, sans-serif" font-size="22" letter-spacing="4" fill="${accent}" opacity="0.85">GOLPO LOCAL · ${label}</text>
  <foreignObject x="72" y="240" width="${width - 144}" height="320">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Satoshi,Inter,'Segoe UI',sans-serif;color:${ink};font-size:64px;font-weight:700;line-height:1.12;letter-spacing:-1px;">
      ${wrap(video.title, 34)
        .slice(0, 3)
        .map((line) => escapeXml(line))
        .join("<br/>")}
    </div>
  </foreignObject>
  <g font-family="Inter, 'Segoe UI', sans-serif" fill="${ink}" opacity="0.78">
    <text x="72" y="${height - 96}" font-size="24">${escapeXml(video.style.replace(/_/g, " "))} · ${video.duration_seconds}s · ${escapeXml(video.display_language)}</text>
    <text x="72" y="${height - 60}" font-size="18" opacity="0.7">Simulated render · local development</text>
  </g>
  <g transform="translate(${width - 220} ${height - 116})">
    <rect width="148" height="56" rx="28" fill="${accent}" opacity="0.16"/>
    <text x="74" y="36" text-anchor="middle" font-family="Inter, 'Segoe UI', sans-serif" font-size="20" fill="${accent}">Preview</text>
  </g>
</svg>`;
}

export function renderPreview(video: Video): string {
  const { width, height, bg, bg2, accent, ink } = frame(video);
  const chunks = captionChunks(video);
  const perScene = 4;
  const total = chunks.length * perScene;

  const captions = chunks
    .map((chunk, index) => {
      const begin = index * perScene;
      const lines = chunk.split("\n");
      const body = lines
        .map((line, lineIndex) => {
          const dy = lineIndex === 0 ? 0 : 58;
          return `<tspan x="0" dy="${dy}">${escapeXml(line)}</tspan>`;
        })
        .join("");
      return `<g opacity="0">
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.86;1" dur="${perScene}s" begin="${begin}s" repeatCount="indefinite"/>
      <text x="0" y="0" font-family="Satoshi, Inter, 'Segoe UI', sans-serif" font-size="46" font-weight="600" fill="${ink}">${body}</text>
    </g>`;
    })
    .join("\n");

  const ticker = (video.script ?? video.title)
    .replace(/\s+/g, " ")
    .slice(0, 260);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(video.title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="${bg2}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>

  <g opacity="0.16" stroke="${accent}" stroke-width="3" fill="none">
    <path d="M120 560 C 320 480, 470 640, 690 540 S 1040 470, 1170 560">
      <animate attributeName="stroke-dasharray" values="0 2000;2000 0;2000 0;0 2000" keyTimes="0;0.4;0.8;1" dur="${total}s" repeatCount="indefinite"/>
    </path>
  </g>

  <g transform="translate(96 96)">
    <rect x="0" y="0" width="54" height="54" rx="14" fill="${accent}" opacity="0.2"/>
    <path d="M14 38 L27 16 L40 38 Z" fill="${accent}"/>
    <text x="72" y="36" font-family="Inter, 'Segoe UI', sans-serif" font-size="22" letter-spacing="3" fill="${accent}" opacity="0.9">GOLPO LOCAL</text>
  </g>

  <g transform="translate(120 300)">${captions}</g>

  <g transform="translate(96 ${height - 128})">
    <rect width="${width - 192}" height="4" rx="2" fill="${ink}" opacity="0.14"/>
    <rect width="${width - 192}" height="4" rx="2" fill="${accent}">
      <animate attributeName="width" values="0;${width - 192}" dur="${total}s" repeatCount="indefinite"/>
    </rect>
    <text x="0" y="44" font-family="Inter, 'Segoe UI', sans-serif" font-size="17" fill="${ink}" opacity="0.55">${escapeXml(ticker)}</text>
  </g>

  <text x="${width - 96}" y="${height - 46}" text-anchor="end" font-family="Inter, 'Segoe UI', sans-serif" font-size="16" fill="${ink}" opacity="0.45">Simulated render · ${escapeXml(video.display_language)}</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// Raster-friendly variants used by the FFmpeg renderer.
//
// librsvg (via sharp) does not reliably support <foreignObject>, so these
// frames use only <text>/<tspan>. Fonts fall back to plain sans-serif.
// ---------------------------------------------------------------------------

const RASTER_FONT = "Arial, Helvetica, sans-serif";

function titleLines(video: Video, maxChars: number, maxLines: number): string[] {
  return wrap(video.title, maxChars).slice(0, maxLines);
}

/** Poster as a plain-SVG string (rendered to JPEG by sharp). */
export function renderRasterPoster(video: Video): string {
  const { width, height, seed, bg, bg2, accent, ink } = frame(video);
  const label = video.is_audio_only ? "PODCAST" : video.engine === "golpo_sketch" ? "SKETCH" : "CANVAS";
  const lines = titleLines(video, 32, 3)
    .map(
      (line, index) =>
        `<text x="72" y="${300 + index * 74}" font-family="${RASTER_FONT}" font-size="64" font-weight="700" fill="${ink}">${escapeXml(line)}</text>`,
    )
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="${bg2}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <circle cx="${180 + (seed % 400)}" cy="${140 + (seed % 200)}" r="220" fill="${accent}" opacity="0.10"/>
  <circle cx="${width - 160}" cy="${height - 120}" r="300" fill="${accent}" opacity="0.07"/>
  <path d="M84 104 L110 62 L136 104 Z" fill="${accent}"/>
  <text x="152" y="104" font-family="${RASTER_FONT}" font-size="24" letter-spacing="4" fill="${accent}" opacity="0.85">GOLPO LOCAL · ${label}</text>
  ${lines}
  <text x="72" y="${height - 96}" font-family="${RASTER_FONT}" font-size="24" fill="${ink}" opacity="0.78">${escapeXml(video.style.replace(/_/g, " "))} · ${video.duration_seconds}s · ${escapeXml(video.display_language)}</text>
  <text x="72" y="${height - 58}" font-family="${RASTER_FONT}" font-size="18" fill="${ink}" opacity="0.55">Rendered locally with FFmpeg</text>
</svg>`;
}

/** One flat frame per scene, encoded into the final MP4. */
export function renderSceneFrame(
  video: Video,
  scene: { narration: string; visual: string },
  index: number,
  total: number,
): string {
  const { width, height, bg, bg2, accent, ink } = frame(video);
  const label = video.is_audio_only ? "PODCAST" : video.engine === "golpo_sketch" ? "SKETCH" : "CANVAS";
  const lines = wrap(scene.narration, 44).slice(0, 6);
  const body = lines
    .map(
      (line, lineIndex) =>
        `<text x="96" y="${286 + lineIndex * 62}" font-family="${RASTER_FONT}" font-size="44" font-weight="600" fill="${ink}">${escapeXml(line)}</text>`,
    )
    .join("\n  ");
  const progressWidth = Math.round(((index + 1) / Math.max(1, total)) * (width - 192));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="${bg2}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <circle cx="${width - 200}" cy="120" r="260" fill="${accent}" opacity="0.07"/>
  <path d="M70 82 L94 44 L118 82 Z" fill="${accent}"/>
  <text x="134" y="80" font-family="${RASTER_FONT}" font-size="21" letter-spacing="3" fill="${accent}" opacity="0.9">GOLPO LOCAL · ${label}</text>
  <text x="${width - 72}" y="80" text-anchor="end" font-family="${RASTER_FONT}" font-size="19" fill="${ink}" opacity="0.55">SCENE ${index + 1} / ${total}</text>
  ${body}
  <text x="96" y="${height - 150}" font-family="${RASTER_FONT}" font-size="19" fill="${ink}" opacity="0.6">${escapeXml(scene.visual)}</text>
  <rect x="96" y="${height - 110}" width="${width - 192}" height="5" rx="2.5" fill="${ink}" opacity="0.14"/>
  <rect x="96" y="${height - 110}" width="${progressWidth}" height="5" rx="2.5" fill="${accent}"/>
  <text x="96" y="${height - 62}" font-family="${RASTER_FONT}" font-size="17" fill="${ink}" opacity="0.5">${escapeXml(video.style.replace(/_/g, " "))} · ${escapeXml(video.display_language)}</text>
</svg>`;
}
