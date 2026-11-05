import "server-only";

import { groqChatJson } from "@/lib/ai/groq";
import { GROQ_MODEL, scriptMode } from "@/lib/integrations";
import { languageName } from "@/lib/generation/config";
import {
  buildScript,
  countWords,
  type BuiltScript,
  type Scene,
  trimToDuration,
} from "@/lib/generation/script";
import type { GenerationKind } from "@/lib/types";

/**
 * Picks the script writer.
 *
 * - A user-supplied script is never rewritten.
 * - With GOLPO_SCRIPT_MODE=groq (the default once GROQ_API_KEY is set),
 *   the prompt goes to the model.
 * - Anything that goes wrong (missing key, timeout, malformed JSON, model
 *   refusal) logs a warning and falls back to the deterministic local writer,
 *   so a generation never fails because of the LLM.
 */

interface ModelScript {
  script?: unknown;
  scenes?: Array<{ narration?: unknown; visual?: unknown }>;
}

interface WriteScriptOptions {
  prompt: string;
  durationSeconds: number;
  kind: GenerationKind;
  scriptText?: string | null;
  displayLanguage?: string;
}

const SYSTEM_PROMPT = `You are a senior explainer-video scriptwriter.
Return ONLY a JSON object with this shape:
{"script": string, "scenes": [{"narration": string, "visual": string}]}

Rules:
- "script" is the full spoken narration as plain prose. No headings, no stage directions, no markdown.
- Each scene's "narration" is a contiguous piece of that script, in order. Joining all scenes must reproduce the script.
- Keep sentences short (roughly 12-22 words) and spoken-friendly. No camera instructions in the narration.
- "visual" describes one simple whiteboard-style illustration for that scene, in one sentence.
- Do not invent statistics, quotes, or citations. If a number is not well known, describe the idea instead.
- Write in the requested language.
- Respect the word budget: staying slightly under is better than going over.`;

function targetWords(durationSeconds: number): number {
  return Math.max(20, Math.round(durationSeconds * 2.4));
}

function sceneTarget(durationSeconds: number): number {
  return Math.min(14, Math.max(3, Math.round(durationSeconds / 9)));
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function tidyNarration(text: string): string {
  if (!text) return "";
  const capitalized = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

/** Drops trailing scenes until the narration fits the spoken word budget. */
function fitScenes(rawScenes: Array<{ narration: string; visual: string }>, maxWords: number) {
  const kept = rawScenes.filter((scene) => scene.narration.length > 0);
  let words = kept.reduce((total, scene) => total + countWords(scene.narration), 0);
  while (kept.length > 2 && words > maxWords) {
    const dropped = kept.pop();
    words -= countWords(dropped?.narration ?? "");
  }
  return kept;
}

function toScenes(
  rawScenes: Array<{ narration: string; visual: string }>,
  durationSeconds: number,
): Scene[] {
  const totalWords = Math.max(
    1,
    rawScenes.reduce((total, scene) => total + countWords(scene.narration), 0),
  );
  let elapsed = 0;
  return rawScenes.map((scene, index) => {
    const startSeconds = Math.round(elapsed);
    elapsed += (countWords(scene.narration) / totalWords) * durationSeconds;
    return {
      index,
      narration: scene.narration,
      visual: scene.visual || "A simple sketched illustration of the narration",
      startSeconds,
    };
  });
}

async function writeWithGroq(options: WriteScriptOptions): Promise<BuiltScript> {
  const budget = targetWords(options.durationSeconds);
  const requestedScenes = sceneTarget(options.durationSeconds);
  const language = options.displayLanguage?.trim() || languageName("en");
  const format = options.kind === "podcast" ? "audio-only podcast episode" : "explainer video";

  const userPrompt = [
    `Create the narration for a ${options.durationSeconds}-second ${format}.`,
    `Language: ${language}.`,
    `Target length: about ${budget} spoken words, split into ${requestedScenes} scenes.`,
    "",
    "Source material from the creator:",
    options.prompt.trim(),
  ].join("\n");

  const result = await groqChatJson<ModelScript>({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    model: GROQ_MODEL,
    temperature: 0.65,
    maxTokens: Math.min(4_000, Math.max(900, Math.round(budget * 2.4))),
  });

  let scenes = Array.isArray(result.scenes)
    ? result.scenes
        .map((scene) => ({
          narration: tidyNarration(asText(scene?.narration)),
          visual: asText(scene?.visual),
        }))
        .filter((scene) => scene.narration.length > 0)
        .slice(0, 14)
    : [];

  if (scenes.length === 0) {
    const script = trimToDuration(asText(result.script), options.durationSeconds);
    if (!script) throw new Error("model returned no usable narration");
    // Re-run the local structurer with the model text as a user-supplied script.
    const local = buildScript({ ...options, scriptText: script });
    return { ...local, source: "groq", model: GROQ_MODEL };
  }

  scenes = fitScenes(scenes, budget);

  // The joined scenes are the single source of truth, so the stored script and
  // the rendered narration can never drift apart.
  const script = trimToDuration(
    scenes.map((scene) => scene.narration).join(" "),
    options.durationSeconds,
  );

  return {
    script,
    scenes: toScenes(scenes, options.durationSeconds),
    wordCount: countWords(script),
    source: "groq",
    model: GROQ_MODEL,
  };
}

export async function writeScript(options: WriteScriptOptions): Promise<BuiltScript> {
  if (options.scriptText?.trim()) return buildScript(options);
  if (scriptMode !== "groq") return buildScript(options);

  try {
    return await writeWithGroq(options);
  } catch (error) {
    console.warn(
      `[script] Groq failed, falling back to the local writer: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return buildScript(options);
  }
}
