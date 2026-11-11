import type { GenerationKind } from "@/lib/types";

/**
 * Deterministic local "script writer".
 *
 * The live product enforces a hard character budget derived from the requested
 * duration: **1,050 characters per minute** in Script Mode, and a flat
 * 18,500-character ceiling in prompt mode (`docs/forensics/live/audit-notes.txt`).
 * The local writer previously ignored both and emitted ~118 words no matter how
 * long the video was, which is why long videos froze on one frame. Everything
 * below is sized against that budget.
 *
 * The real product sends the prompt to a server-side LLM (no model identifiers
 * are exposed in the client bundle — REPORT.md section 13). This module is the
 * deterministic fallback and the seam where that call belongs:
 *
 * TODO(REAL-GENERATION): keep `BuiltScript` stable so the pipeline and UI do
 * not change when the Groq writer takes over.
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
  /** Where the text came from — surfaced in logs and the job snapshot. */
  source: "local" | "groq" | "user";
  model?: string;
}

// ---------------------------------------------------------------------------
// Budget constants — transcribed from the live Script Mode counter.
// ---------------------------------------------------------------------------

/** Script Mode budget: `Character limit based on 1 min duration (1050 chars/min)`. */
export const SCRIPT_CHARS_PER_MINUTE = 1050;

/** Prompt mode ceiling: the live counter reads `0 / 18500 characters`. */
export const PROMPT_CHAR_LIMIT = 18500;

/**
 * Planning pace. Orpheus and Edge read at roughly 2.8 words/second; 1,050
 * chars/min ÷ 6.25 chars/word ≈ 168 words/min ≈ 2.8 words/s, so the two
 * budgets agree.
 */
export const SPOKEN_WORDS_PER_SECOND = 2.8;

/** Average English word length used to convert a character budget to words. */
export const AVG_CHARS_PER_WORD = 6.25;

/** The live product makes one frame per sentence; cap runaway scripts. */
export const MAX_SCENES = 60;

/** Character budget for a duration, rounded like the live counter. */
export function targetCharCount(durationSeconds: number): number {
  const seconds = Number.isFinite(durationSeconds) ? Math.max(15, durationSeconds) : 60;
  return Math.max(120, Math.round((seconds / 60) * SCRIPT_CHARS_PER_MINUTE));
}

/** Alias used by the API validator and the UI counter. */
export const scriptBudget = targetCharCount;

/** `1 min`, `30 sec`, `1 min 30 sec` — matches the duration dropdown copy. */
export function formatMinutes(durationSeconds: number): string {
  const total = Math.max(1, Math.round(durationSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds} sec`;
  if (seconds === 0) return `${minutes} min`;
  return `${minutes} min ${seconds} sec`;
}

/** Words to aim for at a given duration. */
export function targetWordCount(durationSeconds: number): number {
  return Math.max(20, Math.round(durationSeconds * SPOKEN_WORDS_PER_SECOND));
}

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

// ---------------------------------------------------------------------------
// Sentence material
//
// Templates are deliberately topic-agnostic so they stay true for any subject.
// `{topic}` / `{step}` are filled in; when a pool wraps around, a connector
// changes the sentence so the script never repeats a line verbatim.
// ---------------------------------------------------------------------------

const HOOKS = [
  "Most people think {topic} is complicated, but the core idea is surprisingly simple.",
  "Here is the shortest useful explanation of {topic} you will hear today.",
  "If you have ever felt lost in {topic}, this walkthrough is for you.",
  "Let's talk about {topic} in the order that actually makes it click.",
  "There is a pattern behind {topic}, and once you see it you cannot unsee it.",
];

const DEFINITIONS = [
  "At its heart, {topic} is a system of small decisions that compound over time.",
  "Put simply, {topic} is about turning a clear goal into repeatable steps.",
  "The useful way to frame {topic} is: what changes, what stays the same, and why.",
  "Before the details, hold on to one sentence: {topic} works when the inputs are visible.",
];

const WHY = [
  "This matters because the cost of guessing is usually higher than the cost of checking.",
  "Understanding the mechanism is what separates a lucky result from a repeatable one.",
  "When you know why something works, you can adapt it instead of copying it.",
  "The same logic shows up in classrooms, in teams, and in everyday choices.",
  "The practical payoff is confidence: you stop changing everything at once.",
  "That is why the explanation is worth two minutes of your attention.",
  "Small errors early become expensive later, so clarity up front saves time.",
  "Once the structure is clear, the vocabulary stops feeling like a barrier.",
];

const MECHANISM = [
  "Start by clarifying the goal in one plain sentence, without jargon.",
  "Next, gather the inputs you already have before adding anything new.",
  "Then connect each step to a visible result, so progress is measurable.",
  "Look for the bottleneck: the one place where everything slows down.",
  "Change one variable at a time, otherwise you cannot tell what caused the result.",
  "Write down the assumption you are least sure about, then test it.",
  "Keep a short feedback loop so you learn before the stakes get high.",
  "Separate the signal from the noise by asking what would prove you wrong.",
  "Reduce the problem until the next step is obvious, then take that step.",
  "Repeat the process until the pattern holds without supervision.",
];

const EXAMPLES = [
  "Imagine you are explaining this to a friend who has five minutes and no background.",
  "Picture a small team trying the idea on one project before rolling it out.",
  "Think about a student who understands the rule but keeps making the same slip.",
  "Consider the version of this that fits on a single index card.",
  "A simple example makes the abstract part concrete almost immediately.",
  "Now scale that example up: the same logic still applies, just with more moving parts.",
  "The first attempt will be rough; that is data, not failure.",
  "Compare the result against the goal, not against someone else's version of it.",
];

const PITFALLS = [
  "The common mistake is optimizing a step before understanding the whole flow.",
  "Another trap is adding complexity to hide an unclear goal.",
  "People often confuse activity with progress, and the two are not the same.",
  "Do not skip the boring check; it is usually where the real problem hides.",
  "If the explanation needs ten caveats, the model is probably too complicated.",
  "Watch for the moment the process starts serving itself instead of the goal.",
  "A confident answer is not the same as a correct one, so verify the cheap way first.",
  "The fastest route is often to remove a step rather than speed one up.",
];

const TAKEAWAYS = [
  "So the takeaway is this: keep the goal visible, change one thing at a time, and check the result.",
  "That is the whole idea. Start small, measure what changed, and build from there.",
  "If you remember one thing, remember the order: clarify, test, then scale.",
  "Clarity beats complexity, and a small verified step beats a big guess.",
  "Put it into practice once and the pattern becomes much easier to see.",
  "You do not need every detail today; you need the next honest step.",
];

const TRANSITIONS = [
  "That brings us to the practical part.",
  "Here is where it gets interesting.",
  "Now let's connect the pieces.",
  "With that foundation, the next step is easier to see.",
  "This is the part most explanations skip.",
  "Let's make that concrete.",
];

const CONNECTORS = [
  "",
  "In practice, ",
  "To put it another way, ",
  "Here is the part people miss: ",
  "From experience, ",
  "A useful way to think about it: ",
  "At the same time, ",
  "More importantly, ",
];

const PODCAST_LINES = [
  "Because this episode is audio only, every idea has to stand on its own without a diagram.",
  "Listen for the structure as we go: goal, mechanism, example, and takeaway.",
  "You can replay any section without losing the thread.",
  "We will keep the language concrete so it works without visuals.",
];

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function fill(template: string, topic: string): string {
  return template.replace(/\{topic\}/g, topic);
}

/**
 * Expands the sentence pools until the character budget is satisfied.
 * Duplicate lines are skipped, and a wrapping pool is prefixed with a
 * connector so no two sentences are identical.
 */
function composeBody(options: {
  prompt: string;
  topic: string;
  budget: number;
  kind: GenerationKind;
  displayLanguage?: string;
  seed: number;
}): string[] {
  const { prompt, topic, budget, kind, displayLanguage, seed } = options;
  const sentences: string[] = [];
  const seen = new Set<string>();
  let length = 0;

  const add = (raw: string): boolean => {
    const sentence = tidy(raw);
    if (!sentence) return false;
    const key = sentence.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    const next = length === 0 ? sentence.length : length + 1 + sentence.length;
    if (next > budget) return false;
    seen.add(key);
    sentences.push(sentence);
    length = next;
    return true;
  };

  // Reserve room for the closing line so the budget does not swallow it.
  const closer = fill(pick(TAKEAWAYS, seed + 5), topic);
  const reserved = closer.length + 1;
  const bodyBudget = Math.max(80, budget - reserved);

  const addWithBudget = (raw: string): boolean => {
    const sentence = tidy(raw);
    if (!sentence) return false;
    const key = sentence.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    const next = length === 0 ? sentence.length : length + 1 + sentence.length;
    if (next > bodyBudget) return false;
    seen.add(key);
    sentences.push(sentence);
    length = next;
    return true;
  };

  addWithBudget(fill(pick(HOOKS, seed), topic));
  addWithBudget(fill(pick(DEFINITIONS, seed + 1), topic));

  // Fold the user's own prompt back in, so the script stays on-topic.
  const promptSentences = splitSentences(prompt);
  for (const sentence of promptSentences.slice(0, 4)) {
    if (sentence.length >= 20) addWithBudget(sentence);
  }

  if (kind === "podcast") {
    addWithBudget(pick(PODCAST_LINES, seed));
  }

  const sections = [WHY, MECHANISM, EXAMPLES, PITFALLS];
  let cycle = 0;
  while (length < bodyBudget && cycle < 40) {
    for (const section of sections) {
      for (let index = 0; index < section.length; index += 1) {
        const connector = cycle === 0 ? "" : CONNECTORS[1 + ((cycle + index) % (CONNECTORS.length - 1))];
        const base = fill(section[(index + seed) % section.length], topic);
        const candidate = connector ? `${connector}${lowerFirst(base)}` : base;
        addWithBudget(candidate);
        if (length >= bodyBudget) break;
      }
      if (length >= bodyBudget) break;
    }
    if (cycle === 1) addWithBudget(pick(TRANSITIONS, seed));
    cycle += 1;
  }

  // The closing line is mandatory; drop body lines only if it would overflow.
  if (length + 1 + closer.length > budget && sentences.length > 0) {
    while (sentences.length > 0 && length + 1 + closer.length > budget) {
      const removed = sentences.pop() as string;
      length -= removed.length + (sentences.length > 0 ? 1 : 0);
    }
  }
  add(closer);

  if (displayLanguage && displayLanguage !== "English") {
    add(`On-screen text is rendered in ${displayLanguage}, while the narration stays as spoken.`);
  }

  return sentences;
}

/** Groups a script into scenes — one frame per sentence, like the real product. */
export function scriptToScenes(script: string, durationSeconds: number, seed = 0): Scene[] {
  const sentences = splitSentences(script);
  if (sentences.length === 0) return [];

  // One sentence per scene (the live FAQ says "one frame per sentence"), but
  // group only if the script exceeds the scene cap.
  const perScene = Math.ceil(sentences.length / MAX_SCENES);
  const scenes: Scene[] = [];
  const totalScenes = Math.ceil(sentences.length / perScene);
  for (let index = 0; index < totalScenes; index += 1) {
    const slice = sentences.slice(index * perScene, (index + 1) * perScene);
    if (slice.length === 0) break;
    scenes.push({
      index,
      narration: slice.join(" "),
      visual: visualFor(index, seed + index),
      startSeconds: Math.round((index / Math.max(1, totalScenes)) * durationSeconds),
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
  const budget = targetCharCount(durationSeconds);

  if (scriptText?.trim()) {
    const script = trimToDuration(scriptText.trim(), durationSeconds);
    return {
      script,
      scenes: scriptToScenes(script, durationSeconds, seed),
      wordCount: countWords(script),
      source: "user",
    };
  }

  const topic = topicFrom(prompt);
  const sentences = composeBody({
    prompt,
    topic,
    budget,
    kind,
    displayLanguage,
    seed,
  });

  let script = sentences.join(" ");
  // Safety net: never exceed the visible budget.
  if (script.length > budget) {
    script = trimToCharBudget(script, budget);
  }

  return {
    script,
    scenes: scriptToScenes(script, durationSeconds, seed),
    wordCount: countWords(script),
    source: "local",
  };
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Trims the tail so a script fits the character budget, keeping whole
 * sentences and never cutting mid-word.
 */
export function trimToCharBudget(script: string, budget: number): string {
  const sentences = splitSentences(script);
  const kept: string[] = [];
  let length = 0;
  for (const sentence of sentences) {
    const next = length === 0 ? sentence.length : length + 1 + sentence.length;
    if (next > budget && kept.length > 0) break;
    kept.push(sentence);
    length = next;
  }
  return kept.join(" ");
}

/**
 * Trims a user-supplied script to the duration budget. `tolerance` allows a
 * small overshoot without losing a whole sentence.
 */
export function trimToDuration(script: string, durationSeconds: number, tolerance = 1): string {
  const budget = Math.round(targetCharCount(durationSeconds) * Math.max(1, tolerance));
  return trimToCharBudget(script, budget);
}
