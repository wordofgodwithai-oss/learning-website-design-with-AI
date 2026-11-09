import "server-only";

import {
  GROQ_API_KEY,
  GROQ_BASE_URL,
  GROQ_TIMEOUT_MS,
  GROQ_TTS_MODEL,
  GROQ_TTS_VOICE,
  GROQ_TRANSCRIBE_MODEL,
} from "@/lib/integrations";

/**
 * Minimal Groq client (no SDK).
 *
 * Groq exposes an OpenAI-compatible API under /openai/v1, so this file keeps
 * the same request/response shapes the app used before while only changing the
 * base URL, models and key. Everything has an explicit timeout and no retries:
 * a slow or failed model call must degrade to the local deterministic fallback
 * instead of blocking a generation job.
 */

export class GroqError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "GroqError";
    this.status = status;
  }
}

function endpoint(path: string): string {
  return `${GROQ_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function authorization(): string {
  if (!GROQ_API_KEY) throw new GroqError("GROQ_API_KEY is not configured.", 401);
  return `Bearer ${GROQ_API_KEY}`;
}

async function describeFailure(response: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? "";
  } catch {
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      detail = "";
    }
  }
  return `Groq responded ${response.status}${detail ? `: ${detail}` : ""}`;
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

/** Pulls the first JSON object/array out of a reply that may wrap it in prose. */
function extractJson(value: string): string {
  const stripped = stripCodeFence(value);
  if (/^[[{]/.test(stripped)) return stripped;
  const start = stripped.search(/[[{]/);
  if (start === -1) return stripped;
  const end = Math.max(stripped.lastIndexOf("}"), stripped.lastIndexOf("]"));
  return end > start ? stripped.slice(start, end + 1) : stripped.slice(start);
}

// ---------------------------------------------------------------------------
// Chat completions (script generation)
// ---------------------------------------------------------------------------

interface ChatOptions {
  system: string;
  user: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

interface ChatReply {
  content: string;
  finishReason: string;
  reasoning: string;
}

async function requestChat(
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<ChatReply> {
  const response = await fetch(endpoint("chat/completions"), {
    method: "POST",
    headers: {
      authorization: authorization(),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new GroqError(await describeFailure(response), response.status);
  const data = (await response.json()) as {
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string; reasoning?: string };
    }>;
  };
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content ?? "",
    finishReason: choice?.finish_reason ?? "",
    reasoning: choice?.message?.reasoning ?? "",
  };
}

/** True for replies we can safely retry with a different request shape. */
function isRetryableShape(error: unknown): boolean {
  if (!(error instanceof GroqError) || error.status !== 400) return false;
  return /json|response_format|failed_generation/i.test(error.message);
}

/**
 * Reasoning models on Groq (gpt-oss, qwen3, deepseek-r1) reject
 * `response_format: {type: "json_object"}` with `400 json_validate_failed`, so
 * asking for it only wastes a round trip. They are still told to answer with
 * JSON in the system prompt, and `extractJson` handles the reply.
 */
function supportsJsonMode(model: string): boolean {
  return !/gpt-oss|qwen3|deepseek|reason|thinking/i.test(model);
}

/**
 * Asks for a JSON object and parses it.
 *
 * Some Groq models (notably `openai/gpt-oss-120b`) are reasoning models and
 * reject `response_format: json_object` with a 400 `json_validate_failed`, and
 * they spend part of `max_tokens` on hidden reasoning before writing the final
 * answer. The retry ladder handles both: drop `response_format` and give the
 * model enough headroom to finish reasoning *and* emit the JSON.
 */
export async function groqChatJson<T>(options: ChatOptions): Promise<T> {
  const baseTokens = options.maxTokens ?? 2_000;
  const jsonMode = supportsJsonMode(options.model);
  // Reasoning models burn tokens before writing the answer, so their first
  // attempt already gets extra headroom (no response_format round trip).
  const attempts: Array<{ responseFormat: boolean; maxTokens: number }> = jsonMode
    ? [
        { responseFormat: true, maxTokens: baseTokens },
        { responseFormat: false, maxTokens: Math.max(baseTokens, 4_000) },
        { responseFormat: false, maxTokens: Math.max(baseTokens * 2, 6_000) },
      ]
    : [
        { responseFormat: false, maxTokens: Math.max(baseTokens, 4_000) },
        { responseFormat: false, maxTokens: Math.max(baseTokens * 2, 8_000) },
      ];

  let lastError: Error | undefined;

  for (const attempt of attempts) {
    const body: Record<string, unknown> = {
      model: options.model,
      temperature: options.temperature ?? 0.6,
      max_tokens: attempt.maxTokens,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.user },
      ],
    };
    if (attempt.responseFormat) body.response_format = { type: "json_object" };

    let reply: ChatReply;
    try {
      reply = await requestChat(body, options.timeoutMs ?? GROQ_TIMEOUT_MS);
    } catch (error) {
      if (isRetryableShape(error)) {
        lastError = error as Error;
        continue;
      }
      throw error;
    }

    const content = reply.content.trim();
    if (!content) {
      // Reasoning-only reply: the token budget was consumed before any answer.
      lastError = new GroqError(
        reply.reasoning
          ? `Groq returned reasoning without a final answer (finish=${reply.finishReason || "unknown"}).`
          : "Groq returned an empty completion.",
      );
      continue;
    }

    try {
      return JSON.parse(extractJson(content)) as T;
    } catch {
      lastError = new GroqError("Groq returned malformed JSON.");
    }
  }

  throw lastError ?? new GroqError("Groq could not return valid JSON.");
}

// ---------------------------------------------------------------------------
// Text to speech (narration)
// ---------------------------------------------------------------------------

/**
 * Orpheus on Groq caps input at 200 characters per request, so longer scene
 * narration is split at sentence (or word) boundaries and the resulting WAVs
 * are joined by the renderer.
 */
const SPEECH_CHUNK_CHARS = 190;

export function chunkForSpeech(text: string, maxChars = SPEECH_CHUNK_CHARS): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [normalized];
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current) {
      chunks.push(current);
      current = "";
    }
  };

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;

    if (sentence.length > maxChars) {
      flush();
      let line = "";
      for (const word of sentence.split(/\s+/)) {
        if (line && `${line} ${word}`.length > maxChars) {
          chunks.push(line);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      if (line) chunks.push(line);
      continue;
    }

    if (current && `${current} ${sentence}`.length > maxChars) flush();
    current = current ? `${current} ${sentence}` : sentence;
  }

  flush();
  return chunks;
}

interface SpeechOptions {
  model?: string;
  voice?: string;
  timeoutMs?: number;
}

/** Synthesises one speech chunk to WAV bytes. */
export async function groqSpeech(text: string, options: SpeechOptions = {}): Promise<Buffer> {
  const response = await fetch(endpoint("audio/speech"), {
    method: "POST",
    headers: {
      authorization: authorization(),
      "content-type": "application/json",
      accept: "audio/wav",
    },
    body: JSON.stringify({
      model: options.model ?? GROQ_TTS_MODEL,
      voice: options.voice ?? GROQ_TTS_VOICE,
      input: text,
      response_format: "wav",
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });
  if (!response.ok) throw new GroqError(await describeFailure(response), response.status);
  return Buffer.from(await response.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Transcription (speech to text + word timestamps)
// ---------------------------------------------------------------------------

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

export interface Transcript {
  text: string;
  language: string | null;
  duration: number | null;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
}

interface TranscribeOptions {
  model?: string;
  /** ISO-639-1 code, or "auto" to let Whisper detect it (default). */
  language?: string;
  prompt?: string;
  filename?: string;
  contentType?: string;
  timeoutMs?: number;
}

function asWords(value: unknown): TranscriptWord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = entry as { word?: unknown; start?: unknown; end?: unknown };
      return {
        word: typeof row.word === "string" ? row.word : "",
        start: Number(row.start),
        end: Number(row.end),
      };
    })
    .filter((row) => row.word.length > 0 && Number.isFinite(row.start) && Number.isFinite(row.end));
}

function asSegments(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = entry as { text?: unknown; start?: unknown; end?: unknown };
      return {
        text: typeof row.text === "string" ? row.text : "",
        start: Number(row.start),
        end: Number(row.end),
      };
    })
    .filter((row) => row.text.length > 0 && Number.isFinite(row.start) && Number.isFinite(row.end));
}

/**
 * Transcribes audio with Whisper on Groq and returns word-level timestamps:
 * `{ words: [{ word, start, end }] }`. `language` is only sent when a real
 * ISO-639-1 code is provided; omitting it makes Whisper auto-detect, which is
 * what "language: auto" means here.
 */
export async function groqTranscribe(
  audio: Blob | ArrayBuffer | Uint8Array,
  options: TranscribeOptions = {},
): Promise<Transcript> {
  const form = new FormData();
  const filename = options.filename ?? "audio.mp3";
  let part: BlobPart;
  if (audio instanceof Blob) {
    part = audio;
  } else if (audio instanceof ArrayBuffer) {
    part = audio;
  } else {
    // Copy into a fresh ArrayBuffer so the Blob constructor gets a concrete
    // ArrayBuffer-backed view (Node's Buffer may be SharedArrayBuffer-backed).
    const copy = new Uint8Array(audio.byteLength);
    copy.set(audio);
    part = copy;
  }
  const blob =
    part instanceof Blob
      ? part
      : new Blob([part], { type: options.contentType ?? "application/octet-stream" });
  form.append("file", blob, filename);
  form.append("model", options.model ?? GROQ_TRANSCRIBE_MODEL);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");

  const language = options.language?.trim();
  if (language && language.toLowerCase() !== "auto") form.append("language", language);
  if (options.prompt?.trim()) form.append("prompt", options.prompt.trim());

  const response = await fetch(endpoint("audio/transcriptions"), {
    method: "POST",
    // Do not set content-type: fetch adds the multipart boundary.
    headers: { authorization: authorization(), accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });
  if (!response.ok) throw new GroqError(await describeFailure(response), response.status);

  const data = (await response.json()) as {
    text?: unknown;
    language?: unknown;
    duration?: unknown;
    words?: unknown;
    segments?: unknown;
  };

  return {
    text: typeof data.text === "string" ? data.text.trim() : "",
    language: typeof data.language === "string" ? data.language : null,
    duration: Number.isFinite(Number(data.duration)) ? Number(data.duration) : null,
    words: asWords(data.words),
    segments: asSegments(data.segments),
  };
}
