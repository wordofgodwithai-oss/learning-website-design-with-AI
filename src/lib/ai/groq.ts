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

/**
 * Asks for a JSON object and parses it. If the endpoint rejects
 * `response_format`, the request is retried once without it.
 */
export async function groqChatJson<T>(options: ChatOptions): Promise<T> {
  const body: Record<string, unknown> = {
    model: options.model,
    temperature: options.temperature ?? 0.6,
    max_tokens: options.maxTokens ?? 2_000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.user },
    ],
  };

  const run = async (includeResponseFormat: boolean): Promise<string> => {
    if (!includeResponseFormat) delete body.response_format;
    const response = await fetch(endpoint("chat/completions"), {
      method: "POST",
      headers: {
        authorization: authorization(),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? GROQ_TIMEOUT_MS),
    });
    if (!response.ok) throw new GroqError(await describeFailure(response), response.status);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new GroqError("Groq returned an empty completion.");
    return content;
  };

  let content: string;
  try {
    content = await run(true);
  } catch (error) {
    if (
      error instanceof GroqError &&
      error.status === 400 &&
      /response_format/i.test(error.message)
    ) {
      content = await run(false);
    } else {
      throw error;
    }
  }

  try {
    return JSON.parse(stripCodeFence(content)) as T;
  } catch {
    throw new GroqError("Groq returned malformed JSON.");
  }
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
