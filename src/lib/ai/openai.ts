import "server-only";

import {
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  OPENAI_TIMEOUT_MS,
  OPENAI_TTS_MODEL,
  OPENAI_TTS_VOICE,
} from "@/lib/integrations";

/**
 * Minimal OpenAI REST client (no SDK).
 *
 * Only the two endpoints this app needs are implemented, both with explicit
 * timeouts and no retries: a slow/failed model call must degrade to the local
 * deterministic fallback rather than block a generation job.
 */

export class OpenAIError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "OpenAIError";
    this.status = status;
  }
}

function endpoint(path: string): string {
  return `${OPENAI_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function authHeaders(): Record<string, string> {
  if (!OPENAI_API_KEY) throw new OpenAIError("OPENAI_API_KEY is not configured.", 401);
  return {
    authorization: `Bearer ${OPENAI_API_KEY}`,
    "content-type": "application/json",
  };
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
  return `OpenAI responded ${response.status}${detail ? `: ${detail}` : ""}`;
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

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
 * `response_format` (some OpenAI-compatible servers do), the request is retried
 * once without it.
 */
export async function openaiChatJson<T>(options: ChatOptions): Promise<T> {
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
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? OPENAI_TIMEOUT_MS),
    });
    if (!response.ok) throw new OpenAIError(await describeFailure(response), response.status);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new OpenAIError("OpenAI returned an empty completion.");
    return content;
  };

  let content: string;
  try {
    content = await run(true);
  } catch (error) {
    if (error instanceof OpenAIError && error.status === 400 && /response_format/i.test(error.message)) {
      content = await run(false);
    } else {
      throw error;
    }
  }

  try {
    return JSON.parse(stripCodeFence(content)) as T;
  } catch {
    throw new OpenAIError("OpenAI returned malformed JSON.");
  }
}

interface SpeechOptions {
  model?: string;
  voice?: string;
  timeoutMs?: number;
}

/** Synthesises narration to MP3 bytes. */
export async function openaiSpeech(text: string, options: SpeechOptions = {}): Promise<Buffer> {
  const response = await fetch(endpoint("audio/speech"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      model: options.model ?? OPENAI_TTS_MODEL,
      voice: options.voice ?? OPENAI_TTS_VOICE,
      input: text,
      response_format: "mp3",
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });
  if (!response.ok) throw new OpenAIError(await describeFailure(response), response.status);
  return Buffer.from(await response.arrayBuffer());
}
