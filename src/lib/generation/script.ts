import type { GenerationKind } from "@/lib/types";

/**
 * Deterministic local "script writer".
 *
 * The real product sends the prompt to a server-side LLM (no model identifiers
 * are exposed in the client bundle — REPORT.md section 13). This module is the
 * seam where that call belongs:
 *
 * TODO(REAL-GENERATION): replace `buildScript` with the real scripting model and
 * keep the `BuiltScript` return shape so the pipeline and UI do not change.
 */

export interface Scene {
  index: number;
  narration: string;
  visual: string;
  /** Seconds into the video where the scene starts (estimated locally). */
  startSeconds: number;
}

export interface BuiltScript {
  script: string;
  scenes: Scene[];
  wordCount: number;
}

const OPENERS = [
  "Here is the idea in one line: {topic}.",
  "Let's break down {topic}.",
  "This is a short explanation of {topic}.",
  "We'll walk through {topic} step by step.",
];

const MIDDLES = [
  "The key thing to understand is why this matters in practice.",
  "Once the basics are clear, the rest follows naturally.",
  "Think of it as a small system where every part has a job.",
  "Most of the confusion disappears when you separate the pieces.",
];

const STEPS = [
  "First, set up the goal in plain language.",
  "Next, gather the inputs you already have.",
  "Then connect each step to a visible result.",
  "Finally, check the outcome and adjust one thing at a time.",
];

const CLOSERS = [
  "That is the whole idea. Keep it simple and iterate.",
  "Put it into practice once, and the pattern becomes obvious.",
  "Start small, measure what changed, and build from there.",
  "The takeaway: clarity beats complexity every time.",
];

function hash(input: string): number {
  let value = 0;
  for (let i = 0; i < input.length; i += 1) {
    value = (value * 31 + input.charCodeAt(i)) >>> 0;
  }
  return value;
}

function pick<T>(items: readonly T[], seed: number): T {
  return items[seed % items.length];
}

function tidy(sentence: string): string {
  const trimmed = sentence.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function topicFrom(prompt: string): string {
  const firstLine = prompt.split(/\n|(?<=[.!?])\s/)[0] ?? prompt;
  const cleaned = firstLine.replace(/^(make|create|generate|build|explain)\s+(a|an|the)?\s*/i, "");
  const topic = cleaned.replace(/[.!?]+$/, "").trim();
  return topic.length > 90 ? `${topic.slice(0, 87)}...` : topic || "your topic";
}

function sceneCountFor(durationSeconds: number): number {
  return Math.min(14, Math.max(3, Math.round(durationSeconds / 9)));
}

/** Groups an existing script into scenes so the storyboard UI has structure. */
export function scriptToScenes(
  script: string,
  durationSeconds: number,
  seed = 0,
): Scene[] {
  const sentences = splitSentences(script);
  const count = Math.min(sceneCountFor(durationSeconds), Math.max(1, sentences.length));
  const perScene = Math.ceil(sentences.length / count);
  const scenes: Scene[] = [];
  for (let index = 0; index < count; index += 1) {
    const slice = sentences.slice(index * perScene, (index + 1) * perScene);
    if (slice.length === 0) break;
    scenes.push({
      index,
      narration: slice.join(" "),
      visual: visualFor(index, seed + index),
      startSeconds: Math.round((index / count) * durationSeconds),
    });
  }
  return scenes;
}

function visualFor(index: number, seed: number): string {
  const visuals = [
    "A hand-drawn title card with the core idea",
    "A simple diagram connecting two labelled boxes",
    "A character pointing at the first step",
    "An arrow sweeping across three short labels",
    "A quick example sketched on the board",
    "A summary card with the takeaway",
    "A closing frame with the Golpo mark",
  ];
  return visuals[(index + seed) % visuals.length];
}

export function buildScript(options: {
  prompt: string;
  durationSeconds: number;
  kind: GenerationKind;
  scriptText?: string | null;
  displayLanguage?: string;
}): BuiltScript {
  const { prompt, durationSeconds, kind, scriptText, displayLanguage } = options;
  const seed = hash(prompt || scriptText || "golpo");

  if (scriptText?.trim()) {
    const script = trimToDuration(scriptText.trim(), durationSeconds);
    return {
      script,
      scenes: scriptToScenes(script, durationSeconds, seed),
      wordCount: countWords(script),
    };
  }

  const topic = topicFrom(prompt);
  const desiredScenes = sceneCountFor(durationSeconds);
  const promptSentences = splitSentences(prompt).filter((sentence) => sentence.length > 0);

  const lines: string[] = [];
  lines.push(pick(OPENERS, seed).replace("{topic}", topic));
  if (promptSentences.length > 1) {
    lines.push(tidy(promptSentences[1]));
  }
  lines.push(pick(MIDDLES, seed + 1));
  if (kind === "podcast") {
    lines.push("Because this is audio only, every idea has to stand on its own without visuals.");
  }
  for (let index = 0; index < Math.max(1, desiredScenes - 4); index += 1) {
    lines.push(pick(STEPS, seed + index));
  }
  lines.push(pick(CLOSERS, seed + 2));
  if (displayLanguage && displayLanguage !== "English") {
    lines.push(`On-screen text is rendered in ${displayLanguage}.`);
  }

  const script = trimToDuration(lines.map(tidy).join(" "), durationSeconds);
  return {
    script,
    scenes: scriptToScenes(script, durationSeconds, seed),
    wordCount: countWords(script),
  };
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** ~2.4 spoken words per second; trims the tail when a script runs long. */
function trimToDuration(script: string, durationSeconds: number): string {
  const maxWords = Math.max(20, Math.round(durationSeconds * 2.4));
  const sentences = splitSentences(script);
  const kept: string[] = [];
  let words = 0;
  for (const sentence of sentences) {
    const sentenceWords = countWords(sentence);
    if (words + sentenceWords > maxWords && kept.length > 0) break;
    kept.push(sentence);
    words += sentenceWords;
  }
  return kept.join(" ");
}
