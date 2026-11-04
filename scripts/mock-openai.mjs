#!/usr/bin/env node
/**
 * Minimal OpenAI-compatible stub for local integration testing.
 *
 * It implements just the two endpoints this app calls:
 *   POST /v1/chat/completions  -> deterministic JSON script
 *   POST /v1/audio/speech      -> synthesized WAV tone sized to the input
 *
 * Usage:
 *   npm run mock:openai
 *   # then in .env.local:
 *   # OPENAI_API_KEY=stub
 *   # OPENAI_BASE_URL=http://127.0.0.1:4010/v1
 *   # GOLPO_SCRIPT_MODE=openai
 *   # GOLPO_TTS_MODE=openai
 *
 * Nothing here is a real model: it exists so the live code paths can be
 * exercised (and the HTTP/JSON/TTS plumbing verified) without spending money.
 */

import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_OPENAI_PORT ?? 4010);

const SCENE_TARGETS = 4;

function words(text) {
  return text.trim().split(/\s+/).filter(Boolean);
}

function buildScript(prompt, durationSeconds) {
  const budget = Math.max(24, Math.round((durationSeconds || 30) * 2.4));
  const topic = (prompt || "a useful idea").trim().replace(/\s+/g, " ").slice(0, 160);
  const sentences = [
    `Here is a short explanation of ${topic}.`,
    `The core idea is easier to remember when it is broken into small steps.`,
    `First, notice what problem the idea is trying to solve.`,
    `Then follow the cause and effect one step at a time.`,
    `Finally, connect it to something you already know.`,
    `That connection is what makes the explanation stick.`,
    `Try restating it in your own words to check your understanding.`,
    `With practice, the whole picture becomes simple.`,
  ].filter((sentence) => words(sentence).length > 0);

  const targetScenes = Math.max(3, Math.min(SCENE_TARGETS, Math.round((durationSeconds || 30) / 9)));
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
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, stub: "mock-openai", port: PORT });
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

  return json(res, 404, { error: { message: `No stub route for ${req.method} ${url.pathname}` } });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock OpenAI listening on http://127.0.0.1:${PORT}/v1`);
});
