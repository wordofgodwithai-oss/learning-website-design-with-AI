import "server-only";

import { groqChatJson } from "@/lib/ai/groq";
import { GROQ_MODEL, scriptMode } from "@/lib/integrations";
import { languageName } from "@/lib/generation/config";
import {
  buildScript,
  countWords,
  scriptToScenes,
  targetWordCount,
  type BuiltScript,
  type Scene,
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
  /** `fill_in`: keep a pasted script and expand it to the requested runtime. */
  fillIn?: boolean;
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
- Hit the word budget exactly: the video's runtime is calculated from it, so fewer words means a shorter video. Do not pad with filler; add real explanation or a concrete example instead.`;

function targetWords(durationSeconds: number): number {
  return targetWordCount(durationSeconds);
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
  return /[.!?。！？]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

interface DraftScene {
  narration: string;
  visual: string;
}

/** The model must land at least this share of the spoken budget before we stop. */
const MIN_BUDGET_RATIO = 0.85;

function parseScenes(result: ModelScript): DraftScene[] {
  if (!Array.isArray(result.scenes)) return [];
  return result.scenes
    .map((scene) => ({
      narration: tidyNarration(asText(scene?.narration)),
      visual: asText(scene?.visual),
    }))
    .filter((scene) => scene.narration.length > 0)
    .slice(0, 14);
}

function totalWords(scenes: DraftScene[]): number {
  return scenes.reduce((total, scene) => total + countWords(scene.narration), 0);
}

/**
 * Trims trailing narration until it fits the spoken word budget.
 *
 * Sentences go first, whole scenes only as a last resort: a 70-word draft for
 * a 60-word budget should lose a sentence, not a third of the story. Dropping
 * scenes first was leaving 2-scene, 30-word scripts for 20-second videos.
 */
function fitScenes(rawScenes: DraftScene[], maxWords: number): DraftScene[] {
  const kept = rawScenes.filter((scene) => scene.narration.length > 0);
  let words = totalWords(kept);

  while (words > maxWords) {
    const last = kept[kept.length - 1];
    if (!last) break;

    const sentences = (last.narration.match(SENTENCE_PATTERN) ?? [])
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (sentences.length > 1) {
      const trimmed = sentences.slice(0, -1).join(" ").trim();
      const removed = countWords(last.narration) - countWords(trimmed);
      if (trimmed && removed > 0) {
        kept[kept.length - 1] = { ...last, narration: trimmed };
        words -= removed;
        continue;
      }
    }

    if (kept.length > 1) {
      const dropped = kept.pop();
      words -= countWords(dropped?.narration ?? "");
      continue;
    }

    // One scene, one sentence: shortening it would break the grammar, and a
    // few extra words only cost a tiny tempo nudge in the renderer.
    break;
  }

  return kept;
}

const SENTENCE_PATTERN = /[^.!?。！？]+[.!?。！？]+["'”’)]*|[^.!?。！？]+$/g;

/** Splits one scene in half at a sentence boundary, or returns null. */
function explodeScene(scene: DraftScene): [DraftScene, DraftScene] | null {
  const sentences = (scene.narration.match(SENTENCE_PATTERN) ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (sentences.length < 2) return null;
  const half = Math.ceil(sentences.length / 2);
  const first = sentences.slice(0, half).join(" ");
  const second = sentences.slice(half).join(" ");
  return [
    { narration: first, visual: scene.visual },
    // Keep the same subject but give the second beat its own framing so the
    // artwork prompt (and therefore the illustration) changes on the cut.
    { narration: second, visual: `${scene.visual} Show the next stage of the idea.` },
  ];
}

/**
 * Grows the storyboard to the requested scene count by splitting the longest
 * scenes. Keeping one idea per scene gives the renderer more distinct artwork
 * instead of a single frame held for the whole video.
 */
function splitToSceneCount(scenes: DraftScene[], target: number): DraftScene[] {
  const working = [...scenes];
  let guard = 0;
  while (working.length < target && guard < 32) {
    guard += 1;
    let index = -1;
    let words = 0;
    for (let cursor = 0; cursor < working.length; cursor += 1) {
      const sceneWords = countWords(working[cursor].narration);
      if (sceneWords > words && explodeScene(working[cursor])) {
        words = sceneWords;
        index = cursor;
      }
    }
    if (index === -1) break;
    const parts = explodeScene(working[index]);
    if (!parts) break;
    working.splice(index, 1, ...parts);
  }
  return working;
}

function expansionInstruction(
  draft: DraftScene[],
  budget: number,
  durationSeconds: number,
): string {
  return [
    `Your previous draft was only ${totalWords(draft)} spoken words.`,
    `For a ${durationSeconds}-second video it needs about ${budget} words.`,
    "Rewrite and EXPAND that draft now: add concrete detail, one short example,",
    "and the practical takeaway, while keeping the same topic, language and tone.",
    "Do not pad with filler. Return the full JSON object again with the same shape.",
    "",
    "Previous draft:",
    draft.map((scene) => scene.narration).join(" "),
  ].join("\n");
}

function toScenes(rawScenes: DraftScene[], durationSeconds: number): Scene[] {
  const total = Math.max(1, totalWords(rawScenes));
  let elapsed = 0;
  return rawScenes.map((scene, index) => {
    const startSeconds = Math.round(elapsed);
    elapsed += (countWords(scene.narration) / total) * durationSeconds;
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

  const basePrompt =
    options.fillIn && options.scriptText?.trim()
      ? [
          `A creator supplied the script below for a ${options.durationSeconds}-second ${format}.`,
          `Language: ${language}.`,
          `It currently runs about ${countWords(options.scriptText)} spoken words; the target is about ${budget}.`,
          `Keep the creator's existing wording, order and meaning, and expand it with real explanation,`,
          `one concrete example and a practical takeaway until it fills the runtime.`,
          `Do not pad with filler and do not change the topic. Split into ${requestedScenes} scenes.`,
          "",
          "Creator's script:",
          options.scriptText.trim(),
        ].join("\n")
      : [
          `Create the narration for a ${options.durationSeconds}-second ${format}.`,
          `Language: ${language}.`,
          `Target length: about ${budget} spoken words (within about 10%), split into ${requestedScenes} scenes.`,
          `Aim for roughly ${Math.max(8, Math.round(budget / requestedScenes))} words of narration per scene.`,
          "Cover the topic from start to finish: a hook, the explanation, one concrete example, and a takeaway.",
          "",
          "Source material from the creator:",
          options.prompt.trim(),
        ].join("\n");

  const maxTokens = Math.min(6_000, Math.max(1_200, Math.round(budget * 3.2)));
  let best: DraftScene[] = [];
  let attempts = 0;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const user =
      attempt === 0
        ? basePrompt
        : [basePrompt, "", expansionInstruction(best, budget, options.durationSeconds)].join("\n");

    const result = await groqChatJson<ModelScript>({
      system: SYSTEM_PROMPT,
      user,
      model: GROQ_MODEL,
      temperature: attempt === 0 ? 0.65 : 0.8,
      maxTokens,
    });
    attempts += 1;

    const scenes = parseScenes(result);
    if (scenes.length > 0) {
      if (totalWords(scenes) > totalWords(best)) best = scenes;
    } else {
      // No scene list: treat the model's prose as a script and structure it
      // locally, but still apply the same length check so a short reply gets
      // the expansion retry instead of becoming a short video. `scriptToScenes`
      // keeps every word; the 12% cap is applied once, after the retry loop.
      const script = asText(result.script);
      if (script) {
        const structured = scriptToScenes(script, options.durationSeconds).map((scene) => ({
          narration: scene.narration,
          visual: scene.visual,
        }));
        if (totalWords(structured) > totalWords(best)) best = structured;
      }
    }

    const words = totalWords(best);
    if (words >= budget * MIN_BUDGET_RATIO) break;

    console.warn(
      `[script] Groq draft ${attempt + 1} was ${words}/${budget} words; asking for an expanded version.`,
    );
  }

  if (best.length === 0) throw new Error("model returned no usable narration");

  console.log(
    `[script] Groq wrote ${totalWords(best)} words in ${attempts} attempt(s) for a ${options.durationSeconds}s target of ${budget} words`,
  );

  const finalScenes = splitToSceneCount(fitScenes(best, Math.round(budget * 1.12)), requestedScenes);

  // The joined scenes are the single source of truth, so the stored script and
  // the rendered narration can never drift apart. fitScenes already enforces
  // the 12% ceiling; the renderer fits a small overrun with a tempo nudge.
  const script = finalScenes.map((scene) => scene.narration).join(" ");

  return {
    script,
    scenes: toScenes(finalScenes, options.durationSeconds),
    wordCount: countWords(script),
    source: "groq",
    model: GROQ_MODEL,
  };
}

export async function writeScript(options: WriteScriptOptions): Promise<BuiltScript> {
  if (options.scriptText?.trim()) {
    // `fill_in` asks the provider to grow the pasted script instead of trimming
    // it, which is what the dashboard's "fill in to duration" toggle does.
    if (options.fillIn && scriptMode === "groq") {
      try {
        return await writeWithGroq(options);
      } catch (error) {
        console.warn(
          `[script] fill-in failed, using the pasted script as-is: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return buildScript(options);
  }
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

interface TranslatableScene {
  index: number;
  narration: string;
  visual: string;
  startSeconds: number;
}

/**
 * Rewrites scenes into another language for a variant video. The scene count
 * and order are preserved; on any failure the original scenes are returned so
 * the caller can decide how to surface the missing translation.
 *
 * `sourceLanguage` lets the caller skip work when the parent is already in the
 * target language (and makes the English target a normal translation instead
 * of the old "assume the source is English" shortcut).
 */
export async function translateScenes(
  scenes: TranslatableScene[],
  language: string,
  sourceLanguage?: string | null,
): Promise<{ scenes: TranslatableScene[]; translated: boolean }> {
  const base = (code: string) => code.toLowerCase().replace("_", "-").split("-")[0];
  if (scenes.length === 0) return { scenes, translated: false };
  if (sourceLanguage && base(sourceLanguage) === base(language)) {
    return { scenes, translated: true };
  }
  if (scriptMode !== "groq") return { scenes, translated: false };

  try {
    const system =
      "You translate explainer-video scenes. Return ONLY JSON {\"scenes\":[{\"narration\":string,\"visual\":string}]} " +
      "with exactly the same number of scenes in the same order. Keep the meaning, tone and rough length. " +
      "Narration must stay natural spoken language in the target language. No notes, no markdown.";
    const user = [
      `Target language: ${languageName(language)} (${language}).`,
      "Scenes:",
      JSON.stringify(scenes.map((scene) => ({ narration: scene.narration, visual: scene.visual }))),
    ].join("\n");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await groqChatJson<{
        scenes?: Array<{ narration?: unknown; visual?: unknown }>;
      }>({
        system,
        user:
          attempt === 0
            ? user
            : `${user}\n\nYour previous reply had the wrong number of scenes. Return exactly ${scenes.length}.`,
        model: GROQ_MODEL,
        temperature: attempt === 0 ? 0.2 : 0.1,
        maxTokens: 4_000,
      });

      if (!Array.isArray(result.scenes) || result.scenes.length !== scenes.length) continue;

      const translated = scenes.map((scene, index) => ({
        ...scene,
        narration: tidyNarration(asText(result.scenes?.[index]?.narration)) || scene.narration,
        visual: asText(result.scenes?.[index]?.visual) || scene.visual,
      }));
      const complete = translated.every(
        (scene, index) => scene.narration !== scenes[index].narration,
      );
      if (complete) return { scenes: translated, translated: true };
    }
    return { scenes, translated: false };
  } catch (error) {
    console.warn(
      `[script] translation to ${language} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { scenes, translated: false };
  }
}
