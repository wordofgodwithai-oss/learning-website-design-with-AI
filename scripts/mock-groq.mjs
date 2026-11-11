#!/usr/bin/env node
/**
 * Minimal Groq-compatible stub for local integration testing.
 *
 * Groq exposes an OpenAI-compatible surface under /openai/v1, so this stub
 * implements the three endpoints the app calls:
 *   POST /v1/chat/completions      -> deterministic JSON script
 *   POST /v1/audio/speech          -> synthesized WAV tone sized to the input
 *   POST /v1/audio/transcriptions  -> verbose_json transcript with word timestamps
 *
 * Usage:
 *   npm run mock:groq
 *   # then in .env.local:
 *   # GROQ_API_KEY=stub
 *   # GROQ_BASE_URL=http://127.0.0.1:4010/openai/v1
 *   # GOLPO_SCRIPT_MODE=groq
 *   # GOLPO_TTS_MODE=groq
 *   # GOLPO_TRANSCRIBE_MODE=groq
 *
 * Nothing here is a real model: it exists so the live code paths can be
 * exercised (and the HTTP/JSON/TTS/Whisper plumbing verified) without spending
 * money.
 */

import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_GROQ_PORT ?? 4010);

const SCENE_TARGETS = 4;

const TRANSCRIPT_SENTENCES = [
  "This is a short recording used to test transcription.",
  "The stub returns word level timestamps for every word.",
  "That lets the player highlight the narration as it plays.",
];

function words(text) {
  return text.trim().split(/\s+/).filter(Boolean);
}

function buildScript(prompt, durationSeconds) {
  // 1,050 characters per minute ÷ 6.25 chars/word ≈ 2.8 words/second, the same
  // budget the live Script Mode counter enforces.
  const budget = Math.max(24, Math.round((durationSeconds || 30) * 2.8));
  const topic = (prompt || "a useful idea").trim().replace(/\s+/g, " ").slice(0, 160);
  const base = [
    `Here is a short explanation of ${topic}.`,
    `The core idea is easier to remember when it is broken into small steps.`,
    `First, notice what problem the idea is trying to solve.`,
    `Then follow the cause and effect one step at a time.`,
    `Finally, connect it to something you already know.`,
    `That connection is what makes the explanation stick.`,
    `Try restating it in your own words to check your understanding.`,
    `With practice, the whole picture becomes simple.`,
  ];
  const pool = [
    `A concrete example makes the abstract part easier to trust.`,
    `Keep the goal visible so the next step stays obvious.`,
    `Change one thing at a time, then check what actually moved.`,
    `The common mistake is adding complexity before the basics are clear.`,
    `A short feedback loop is worth more than a perfect plan.`,
    `Write down the assumption you are least sure about and test it.`,
    `Separate the signal from the noise by asking what would prove you wrong.`,
    `Small verified steps beat one big guess almost every time.`,
  ];
  const connectors = ["", "In practice, ", "More importantly, ", "From experience, "];
  const sentences = [...base];
  let cursor = 0;
  while (words(sentences.join(" ")).length < budget && cursor < 240) {
    const connector = connectors[Math.floor(cursor / pool.length) % connectors.length];
    const line = pool[cursor % pool.length];
    const text = connector ? `${connector}${line.charAt(0).toLowerCase()}${line.slice(1)}` : line;
    sentences.push(text);
    cursor += 1;
  }

  const targetScenes = Math.max(3, Math.min(SCENE_TARGETS, Math.round((durationSeconds || 30) / 6)));
  const perScene = Math.max(1, Math.ceil(sentences.length / targetScenes));
  const scenes = [];
  for (let index = 0; index < sentences.length && scenes.length < targetScenes; index += perScene) {
    const narration = sentences.slice(index, index + perScene).join(" ");
    scenes.push({
      narration,
      visual: `A simple whiteboard sketch illustrating: ${topic}`,
    });
  }

  const script = scenes.map((scene) => scene.narration).join(" ");
  const trimmed = words(script).slice(0, budget).join(" ");
  return {
    script: /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`,
    scenes,
  };
}

/** 16-bit mono WAV with a soft sine tone, length derived from the input text. */
function makeWav(text) {
  const sampleRate = 22_050;
  const seconds = Math.min(4, Math.max(0.8, words(text).length / 3));
  const samples = Math.floor(sampleRate * seconds);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);

  const frequency = 220;
  for (let index = 0; index < samples; index += 1) {
    const envelope = Math.min(1, index / 200, (samples - index) / 200);
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.18 * envelope;
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  return buffer;
}

/** Builds verbose_json-shaped output with word and segment timestamps. */
function buildTranscript() {
  const text = TRANSCRIPT_SENTENCES.join(" ");
  const wordList = [];
  const segments = [];
  let cursor = 0.4;

  for (const sentence of TRANSCRIPT_SENTENCES) {
    const segmentStart = cursor;
    for (const word of words(sentence)) {
      const duration = Math.max(0.18, word.length / 14);
      wordList.push({
        word,
        start: Number(cursor.toFixed(3)),
        end: Number((cursor + duration).toFixed(3)),
      });
      cursor += duration + 0.05;
    }
    segments.push({
      id: segments.length,
      text: sentence,
      start: Number(segmentStart.toFixed(3)),
      end: Number(cursor.toFixed(3)),
    });
    cursor += 0.2;
  }

  return {
    task: "transcribe",
    language: "english",
    duration: Number((cursor + 0.2).toFixed(3)),
    text,
    words: wordList,
    segments,
  };
}

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": payload.length,
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks);
  // Chat/TTS bodies are JSON; transcription is multipart and is not parsed here.
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return { __raw_bytes: raw.length };
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, stub: "mock-groq", port: PORT });
  }

  if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
    const body = await readBody(req);
    const userMessage = Array.isArray(body.messages)
      ? String(body.messages.find((message) => message.role === "user")?.content ?? "")
      : "";
    const durationMatch = userMessage.match(/for a (\d+)-second/);
    const durationSeconds = durationMatch ? Number(durationMatch[1]) : 30;
    const source = userMessage.split("Source material from the creator:")[1]?.trim() || userMessage;
    const result = buildScript(source, durationSeconds);

    console.log(`[stub] chat/completions -> ${result.scenes.length} scenes`);
    return json(res, 200, {
      id: `chatcmpl_stub_${Date.now()}`,
      object: "chat.completion",
      model: body.model ?? "stub",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify(result) },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }

  if (req.method === "POST" && url.pathname.endsWith("/audio/speech")) {
    const body = await readBody(req);
    const input = String(body.input ?? "");
    const wav = makeWav(input);
    console.log(`[stub] audio/speech -> ${wav.length} bytes`);
    res.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length });
    return res.end(wav);
  }

  if (req.method === "POST" && url.pathname.endsWith("/audio/transcriptions")) {
    const body = await readBody(req);
    const transcript = buildTranscript();
    console.log(
      `[stub] audio/transcriptions -> ${body.__raw_bytes ?? 0} bytes in, ${transcript.words.length} words out`,
    );
    return json(res, 200, transcript);
  }

  return json(res, 404, { error: { message: `No stub route for ${req.method} ${url.pathname}` } });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock Groq listening on http://127.0.0.1:${PORT}/openai/v1`);
});
