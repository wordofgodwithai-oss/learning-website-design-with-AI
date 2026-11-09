/**
 * Hand-drawn scene illustrations.
 *
 * The clone has no image-generation vendor, so scene visuals are drawn as SVG
 * "whiteboard doodles" instead of being left as a text caption. Each scene's
 * `visual` description (plus its narration) is matched against a small library
 * of concept sketches — money, growth, risk, checklists, piggy banks, people,
 * targets, calendars, books, shields, rockets, connected boxes and lightbulbs.
 *
 * Every part is drawn in order and can be revealed progressively through
 * `progress` (0..1), which the renderer uses to animate the illustration being
 * sketched during the first moments of a scene.
 */

export interface DoodleOptions {
  /** Scene visual + narration, used to pick the sketch. */
  text: string;
  width: number;
  height: number;
  ink: string;
  accent: string;
  seed: number;
  /** 0 = blank board, 1 = fully drawn. */
  progress: number;
}

const BASE_WIDTH = 600;
const BASE_HEIGHT = 420;

type Part = {
  weight: number;
  draw: (t: number) => string;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function rng(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

// ---------------------------------------------------------------------------
// Primitive "pen" helpers
// ---------------------------------------------------------------------------

function strokePath(
  d: string,
  color: string,
  width: number,
  t: number,
  dashed = false,
): string {
  const p = clamp01(t);
  const dash = dashed ? `stroke-dasharray="10 10"` : `pathLength="1" stroke-dasharray="1 1"`;
  const offset = dashed ? "" : ` stroke-dashoffset="${(1 - p).toFixed(3)}"`;
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${dash}${offset} opacity="${p > 0 ? 1 : 0}"/>`;
}

function strokeCircle(
  cx: number,
  cy: number,
  r: number,
  color: string,
  width: number,
  t: number,
): string {
  const p = clamp01(t);
  const circumference = 2 * Math.PI * r;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${(circumference * (1 - p)).toFixed(1)}" transform="rotate(-90 ${cx} ${cy})" opacity="${p > 0 ? 1 : 0}"/>`;
}

function strokeRect(
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  strokeWidth: number,
  t: number,
  radius = 0,
): string {
  const p = clamp01(t);
  const perimeter = 2 * (width + height);
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-dasharray="${perimeter.toFixed(1)}" stroke-dashoffset="${(perimeter * (1 - p)).toFixed(1)}" opacity="${p > 0 ? 1 : 0}"/>`;
}

function fillShape(d: string, color: string, opacity: number, t: number): string {
  return `<path d="${d}" fill="${color}" opacity="${(clamp01(t) * opacity).toFixed(3)}"/>`;
}

function fillCircle(cx: number, cy: number, r: number, color: string, opacity: number, t: number): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="${(clamp01(t) * opacity).toFixed(3)}"/>`;
}

function text(
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  t: number,
  options: { anchor?: "start" | "middle" | "end"; weight?: number; font?: string } = {},
): string {
  const p = clamp01(t);
  const font = options.font ?? "Arial, Helvetica, sans-serif";
  return `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${options.weight ?? 700}" fill="${color}" text-anchor="${options.anchor ?? "start"}" opacity="${p.toFixed(3)}">${value}</text>`;
}

function arrowHead(x: number, y: number, angleDeg: number, color: string, t: number, size = 24): string {
  const p = clamp01(t);
  const left = angleDeg + 150;
  const right = angleDeg - 150;
  const lx = x + Math.cos((left * Math.PI) / 180) * size;
  const ly = y + Math.sin((left * Math.PI) / 180) * size;
  const rx = x + Math.cos((right * Math.PI) / 180) * size;
  const ry = y + Math.sin((right * Math.PI) / 180) * size;
  return `<path d="M${lx.toFixed(1)} ${ly.toFixed(1)} L${x.toFixed(1)} ${y.toFixed(1)} L${rx.toFixed(1)} ${ry.toFixed(1)}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="${p.toFixed(3)}"/>`;
}

function sparkle(x: number, y: number, size: number, color: string, t: number): string {
  const p = clamp01(t);
  return `<path d="M${x} ${y - size} L${x + size * 0.3} ${y - size * 0.3} L${x + size} ${y} L${x + size * 0.3} ${y + size * 0.3} L${x} ${y + size} L${x - size * 0.3} ${y + size * 0.3} L${x - size} ${y} L${x - size * 0.3} ${y - size * 0.3} Z" fill="${color}" opacity="${(p * 0.7).toFixed(3)}"/>`;
}

function reveal(parts: Part[], progress: number): string {
  const total = parts.reduce((sum, part) => sum + part.weight, 0) || 1;
  let cursor = 0;
  return parts
    .map((part) => {
      const start = cursor / total;
      cursor += part.weight;
      const end = cursor / total;
      const t = end > start ? clamp01((progress - start) / (end - start)) : progress >= end ? 1 : 0;
      return part.draw(t);
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Sketch library
// ---------------------------------------------------------------------------

interface Motif {
  id: string;
  label: string;
  keywords: RegExp;
  draw: (ink: string, accent: string) => Part[];
}

const MOTIFS: Motif[] = [
  {
    id: "money",
    label: "START SMALL",
    keywords:
      /money|cash|coin|dollar|invest|wealth|rich|budget|fund|banknote|savings|save|afford|amount|dollars/i,
    draw: (ink, accent) => [
      {
        weight: 1,
        draw: (t) => strokeRect(110, 48, 320, 150, ink, 6, t, 14),
      },
      {
        weight: 0.6,
        draw: (t) => strokeRect(130, 68, 280, 110, accent, 3, t, 8),
      },
      {
        weight: 0.8,
        draw: (t) => text("$", 270, 152, 92, ink, t, { anchor: "middle", weight: 700 }),
      },
      {
        weight: 0.9,
        draw: (t) =>
          [
            strokeCircle(148, 88, 9, accent, 4, t),
            strokeCircle(392, 158, 9, accent, 4, t),
          ].join(""),
      },
      {
        weight: 1,
        draw: (t) =>
          [
            strokeCircle(160, 322, 22, ink, 5, t),
            strokeCircle(205, 322, 22, ink, 5, t),
            strokeCircle(250, 322, 22, ink, 5, t),
            strokePath("M148 348 C 150 372 210 380 268 348", accent, 5, t),
          ].join(""),
      },
      {
        weight: 1.1,
        draw: (t) =>
          [
            strokePath("M350 360 C 420 320 440 210 488 112", accent, 6, t),
            arrowHead(488, 112, -68, accent, t),
          ].join(""),
      },
    ],
  },
  {
    id: "growth",
    label: "GROWTH",
    keywords:
      /growth|grow|compound|rise|rising|increase|progress|grow|scale|long term|patience|return|profit|build|wealth over time/i,
    draw: (ink, accent) => [
      {
        weight: 0.8,
        draw: (t) =>
          [
            strokePath("M95 348 L95 66", ink, 6, t),
            strokePath("M95 348 L530 348", ink, 6, t),
          ].join(""),
      },
      {
        weight: 1,
        draw: (t) =>
          [
            strokeRect(145, 280, 52, 68, accent, 4, t, 6),
            strokeRect(225, 232, 52, 116, accent, 4, t, 6),
            strokeRect(305, 178, 52, 170, ink, 4, t, 6),
            strokeRect(385, 112, 52, 236, ink, 4, t, 6),
          ].join(""),
      },
      {
        weight: 1.2,
        draw: (t) =>
          [
            strokePath("M130 292 C 210 272 258 208 330 186 C 402 164 448 112 512 82", accent, 7, t),
            arrowHead(512, 82, -32, accent, t),
          ].join(""),
      },
      {
        weight: 0.5,
        draw: (t) =>
          [
            sparkle(500, 180, 14, accent, t),
            sparkle(462, 236, 9, accent, t),
          ].join(""),
      },
    ],
  },
  {
    id: "risk",
    label: "MARKET MOVES",
    keywords:
      /risk|market|stock|graph|chart|volatile|swing|panic|up and down|loss|crash|down|dip|correction|emotion/i,
    draw: (ink, accent) => [
      {
        weight: 0.8,
        draw: (t) =>
          [
            strokePath("M95 348 L95 66", ink, 6, t),
            strokePath("M95 348 L530 348", ink, 6, t),
          ].join(""),
      },
      {
        weight: 1.6,
        draw: (t) =>
          strokePath(
            "M118 252 L178 168 L228 268 L288 148 L342 244 L402 118 L462 206 L512 96",
            accent,
            7,
            t,
          ),
      },
      {
        weight: 0.8,
        draw: (t) => strokePath("M96 230 L522 230", ink, 3, t, true),
      },
      {
        weight: 0.7,
        draw: (t) =>
          [
            text("UP", 470, 74, 26, ink, t, { anchor: "middle" }),
            text("DOWN", 170, 352, 26, ink, t, { anchor: "middle" }),
          ].join(""),
      },
    ],
  },
  {
    id: "checklist",
    label: "THE BASICS",
    keywords:
      /check|checklist|list|step|basics|first|next|then|finally|rule|tip|guide|prepare|know|plan/i,
    draw: (ink, accent) => [
      {
        weight: 1,
        draw: (t) => strokeRect(170, 54, 260, 318, ink, 6, t, 18),
      },
      {
        weight: 0.5,
        draw: (t) => strokeRect(258, 38, 84, 36, accent, 5, t, 12),
      },
      {
        weight: 1.2,
        draw: (t) =>
          [126, 206, 286]
            .map((y, index) =>
              [
                strokeRect(196, y - 26, 34, 34, accent, 4, t, 6),
                strokePath(`M204 ${y - 9} L215 ${y + 2} L228 ${y - 20}`, accent, 5, t),
                strokePath(`M252 ${y - 12} L392 ${y - 12}`, ink, 5, t),
                strokePath(`M252 ${y + 4} L${340 + index * 12} ${y + 4}`, ink, 4, t),
              ].join(""),
            )
            .join(""),
      },
    ],
  },
  {
    id: "piggy",
    label: "SAVE FIRST",
    keywords:
      /piggy|save|saving|emergency|habit|small amount|few dollars|coin|start|deposit/i,
    draw: (ink, accent) => [
      {
        weight: 1.3,
        draw: (t) => strokeCircle(300, 230, 128, ink, 6, t),
      },
      {
        weight: 0.9,
        draw: (t) =>
          [
            strokeCircle(432, 208, 46, ink, 5, t),
            strokeCircle(444, 198, 6, ink, 4, t),
            strokePath("M404 160 L432 122 L458 160", ink, 5, t),
          ].join(""),
      },
      {
        weight: 0.8,
        draw: (t) =>
          [
            strokePath("M224 338 L224 382 L272 382 L272 338", ink, 5, t),
            strokePath("M342 338 L342 382 L390 382 L390 338", ink, 5, t),
            strokePath("M176 210 C 128 208 128 268 176 264", accent, 5, t),
          ].join(""),
      },
      {
        weight: 0.7,
        draw: (t) => strokePath("M262 128 L338 128", accent, 7, t),
      },
      {
        weight: 1,
        draw: (t) =>
          [
            strokeCircle(300, 74, 34, accent, 5, t),
            text("$", 300, 88, 38, accent, t, { anchor: "middle" }),
          ].join(""),
      },
    ],
  },
  {
    id: "person",
    label: "MINDSET",
    keywords:
      /people|person|you|mind|mindset|believe|think|thought|confidence|feel|behaviour|behavior|habit|scared|worry/i,
    draw: (ink, accent) => [
      {
        weight: 0.8,
        draw: (t) =>
          [
            strokeCircle(238, 108, 40, ink, 6, t),
            strokePath("M238 148 L238 268", ink, 6, t),
            strokePath("M196 196 L280 196", ink, 6, t),
            strokePath("M238 268 L198 344", ink, 6, t),
            strokePath("M238 268 L278 344", ink, 6, t),
          ].join(""),
      },
      {
        weight: 0.9,
        draw: (t) =>
          [
            strokeCircle(300, 92, 12, accent, 4, t),
            strokeCircle(334, 70, 18, accent, 4, t),
            strokeCircle(378, 54, 24, accent, 4, t),
          ].join(""),
      },
      {
        weight: 1.1,
        draw: (t) =>
          [
            strokeCircle(480, 76, 58, ink, 5, t),
            strokeCircle(480, 76, 26, accent, 5, t),
            text("$", 480, 90, 40, accent, t, { anchor: "middle" }),
          ].join(""),
      },
      {
        weight: 0.6,
        draw: (t) => strokePath("M300 342 C 360 342 412 330 452 300", accent, 5, t),
      },
    ],
  },
  {
    id: "target",
    label: "SET A GOAL",
    keywords:
      /goal|target|aim|objective|plan|focus|clear|define|outcome|result|purpose/i,
    draw: (ink, accent) => [
      {
        weight: 1.2,
        draw: (t) =>
          [
            strokeCircle(268, 214, 138, ink, 6, t),
            strokeCircle(268, 214, 96, accent, 5, t),
            strokeCircle(268, 214, 52, ink, 5, t),
            fillCircle(268, 214, 16, accent, 1, t),
          ].join(""),
      },
      {
        weight: 1.3,
        draw: (t) =>
          [
            strokePath("M530 58 L286 202", ink, 6, t),
            arrowHead(286, 202, 148, ink, t),
            strokePath("M530 58 L508 44 M530 58 L544 82", accent, 5, t),
          ].join(""),
      },
      {
        weight: 0.5,
        draw: (t) => sparkle(500, 300, 12, accent, t),
      },
    ],
  },
  {
    id: "calendar",
    label: "KEEP GOING",
    keywords:
      /calendar|month|week|day|time|regular|consistent|consistency|routine|every|schedule|long term|habit/i,
    draw: (ink, accent) => [
      {
        weight: 1,
        draw: (t) => strokeRect(136, 70, 328, 286, ink, 6, t, 20),
      },
      {
        weight: 0.5,
        draw: (t) =>
          [
            strokePath("M136 132 L464 132", accent, 5, t),
            strokeRect(196, 50, 24, 40, ink, 5, t, 8),
            strokeRect(380, 50, 24, 40, ink, 5, t, 8),
          ].join(""),
      },
      {
        weight: 1,
        draw: (t) =>
          [
            strokePath("M218 132 L218 356", ink, 3, t),
            strokePath("M300 132 L300 356", ink, 3, t),
            strokePath("M382 132 L382 356", ink, 3, t),
            strokePath("M136 206 L464 206", ink, 3, t),
            strokePath("M136 282 L464 282", ink, 3, t),
          ].join(""),
      },
      {
        weight: 0.9,
        draw: (t) =>
          [
            fillCircle(259, 244, 18, accent, 0.3, t),
            strokePath("M248 244 L256 252 L272 232", accent, 5, t),
            fillCircle(341, 320, 18, accent, 0.2, t),
          ].join(""),
      },
    ],
  },
  {
    id: "books",
    label: "KEEP LEARNING",
    keywords:
      /learn|book|read|knowledge|study|educat|course|understand|basics|research|source/i,
    draw: (ink, accent) => [
      {
        weight: 0.7,
        draw: (t) =>
          [
            strokePath("M300 38 L300 116", accent, 5, t),
            strokePath("M250 62 L218 34", accent, 4, t),
            strokePath("M350 62 L382 34", accent, 4, t),
          ].join(""),
      },
      {
        weight: 0.9,
        draw: (t) =>
          [
            strokeCircle(300, 108, 44, ink, 5, t),
            strokePath("M278 148 L278 168 L322 168 L322 148", ink, 4, t),
            strokePath("M286 178 L314 178", ink, 4, t),
          ].join(""),
      },
      {
        weight: 1.2,
        draw: (t) =>
          [
            strokeRect(120, 286, 250, 40, ink, 4, t, 4),
            strokeRect(150, 240, 250, 40, accent, 4, t, 4),
            strokeRect(110, 194, 250, 40, ink, 4, t, 4),
            strokePath("M150 206 L150 220 M186 250 L186 264 M156 296 L156 310", accent, 4, t),
          ].join(""),
      },
      {
        weight: 0.5,
        draw: (t) => sparkle(470, 150, 14, accent, t),
      },
    ],
  },
  {
    id: "shield",
    label: "PROTECT IT",
    keywords:
      /protect|safe|safety|shield|emergency|insurance|secure|avoid|guard|buffer|diversif/i,
    draw: (ink, accent) => [
      {
        weight: 1.3,
        draw: (t) =>
          strokePath(
            "M300 48 L442 104 L442 220 C442 302 366 352 300 376 C234 352 158 302 158 220 L158 104 Z",
            ink,
            6,
            t,
          ),
      },
      {
        weight: 1,
        draw: (t) => strokePath("M236 210 L288 262 L372 162", accent, 8, t),
      },
      {
        weight: 0.5,
        draw: (t) =>
          [
            strokeCircle(110, 92, 18, accent, 4, t),
            strokeCircle(500, 300, 24, accent, 4, t),
          ].join(""),
      },
    ],
  },
  {
    id: "rocket",
    label: "GET STARTED",
    keywords:
      /start|begin|launch|rocket|grow|first dollar|first step|today|action|beginner|new/i,
    draw: (ink, accent) => [
      {
        weight: 1.3,
        draw: (t) =>
          strokePath(
            "M300 44 C 356 108 366 220 334 306 L266 306 C234 220 244 108 300 44 Z",
            ink,
            6,
            t,
          ),
      },
      {
        weight: 0.7,
        draw: (t) => strokeCircle(300, 152, 30, accent, 5, t),
      },
      {
        weight: 0.8,
        draw: (t) =>
          [
            strokePath("M268 246 L208 330 L266 306", ink, 5, t),
            strokePath("M332 246 L392 330 L334 306", ink, 5, t),
          ].join(""),
      },
      {
        weight: 0.8,
        draw: (t) =>
          [
            strokePath("M276 312 C 284 340 292 360 300 382", accent, 5, t),
            strokePath("M324 312 C 316 340 308 360 300 382", accent, 5, t),
          ].join(""),
      },
      {
        weight: 0.4,
        draw: (t) => sparkle(180, 90, 12, accent, t),
      },
    ],
  },
  {
    id: "boxes",
    label: "CONNECT THE STEPS",
    keywords:
      /diagram|connect|box|step|system|process|flow|pieces|part|structure|between|then|finally/i,
    draw: (ink, accent) => [
      {
        weight: 1,
        draw: (t) => strokeRect(64, 76, 176, 96, ink, 5, t, 14),
      },
      {
        weight: 1,
        draw: (t) => strokeRect(64, 252, 176, 96, ink, 5, t, 14),
      },
      {
        weight: 1,
        draw: (t) => strokeRect(360, 164, 176, 96, accent, 5, t, 14),
      },
      {
        weight: 0.9,
        draw: (t) =>
          [
            strokePath("M250 124 C 310 124 310 186 350 200", ink, 5, t),
            arrowHead(360, 208, 18, ink, t),
            strokePath("M250 300 C 310 300 310 238 350 224", ink, 5, t),
            arrowHead(360, 216, -18, ink, t),
          ].join(""),
      },
      {
        weight: 0.7,
        draw: (t) =>
          [
            text("1", 152, 136, 34, ink, t, { anchor: "middle" }),
            text("2", 152, 312, 34, ink, t, { anchor: "middle" }),
            text("3", 448, 224, 34, accent, t, { anchor: "middle" }),
          ].join(""),
      },
    ],
  },
  {
    id: "idea",
    label: "THE BIG IDEA",
    keywords: /.*/,
    draw: (ink, accent) => [
      {
        weight: 0.7,
        draw: (t) =>
          [
            strokePath("M232 42 L232 70", accent, 5, t),
            strokePath("M186 62 L164 40", accent, 4, t),
            strokePath("M278 62 L300 40", accent, 4, t),
          ].join(""),
      },
      {
        weight: 1.2,
        draw: (t) =>
          [
            strokeCircle(232, 134, 58, ink, 6, t),
            strokePath("M206 188 L206 212 L258 212 L258 188", ink, 5, t),
            strokePath("M214 226 L250 226", ink, 4, t),
          ].join(""),
      },
      {
        weight: 0.9,
        draw: (t) => strokeRect(370, 78, 150, 86, accent, 5, t, 14),
      },
      {
        weight: 0.9,
        draw: (t) => strokeRect(370, 256, 150, 86, ink, 5, t, 14),
      },
      {
        weight: 0.9,
        draw: (t) =>
          [
            strokePath("M300 158 C 344 150 344 180 362 190", ink, 5, t),
            arrowHead(370, 194, 20, ink, t),
            strokePath("M300 238 C 344 246 344 216 362 206", ink, 5, t),
            arrowHead(370, 202, -20, ink, t),
          ].join(""),
      },
    ],
  },
];

function score(motif: Motif, text: string): number {
  const matches = text.match(new RegExp(motif.keywords.source, "gi"));
  if (!matches) return 0;
  // Longer keywords are more specific, so weight them up a little.
  return matches.reduce((total, hit) => total + Math.min(4, Math.max(1, Math.round(hit.length / 5))), 0);
}

export function pickMotif(text: string): Motif {
  const normalized = text.replace(/\s+/g, " ").trim();
  const fallback = MOTIFS[MOTIFS.length - 1];
  let best = fallback;
  let bestScore = 0;
  for (const motif of MOTIFS.slice(0, -1)) {
    const value = score(motif, normalized);
    if (value > bestScore) {
      best = motif;
      bestScore = value;
    }
  }
  return best;
}

/** Short hand-lettered label for the concept sketch. */
export function motifLabel(text: string): string {
  return pickMotif(text).label;
}

/**
 * Renders the concept sketch for a scene into the given box.
 *
 * The sketch is authored on a 600x420 board and scaled to fit, so callers only
 * need to reserve a rectangle.
 */
export function renderDoodles(options: DoodleOptions): string {
  const { text, width, height, ink, accent, seed, progress } = options;
  const motif = pickMotif(text);
  const scale = Math.min(width / BASE_WIDTH, height / BASE_HEIGHT);
  const offsetX = (width - BASE_WIDTH * scale) / 2;
  const offsetY = (height - BASE_HEIGHT * scale) / 2;
  const parts = motif.draw(ink, accent);
  const random = rng(seed);
  const tilt = (random() - 0.5) * 2.4;

  return `<g transform="translate(${offsetX.toFixed(1)} ${offsetY.toFixed(1)}) scale(${scale.toFixed(4)}) rotate(${tilt.toFixed(2)} ${BASE_WIDTH / 2} ${BASE_HEIGHT / 2})">${reveal(parts, clamp01(progress))}</g>`;
}
