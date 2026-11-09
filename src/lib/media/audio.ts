import "server-only";

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import { edgeSpeech } from "@/lib/ai/edge-tts";
import { chunkForSpeech, groqSpeech } from "@/lib/ai/groq";
import {
  FFMPEG_PATH,
  GROQ_TTS_MODEL,
  GROQ_TTS_VOICE,
  ttsMode,
} from "@/lib/integrations";

/**
 * Narration and music.
 *
 * Narration prefers Groq's Orpheus voice for English (the requested vendor),
 * and free Edge read-aloud voices for the other 50-odd languages. Without any
 * provider the renderer falls back to silence, exactly like before.
 */

export interface NarrationRequest {
  text: string;
  language: string;
  voice: string | null;
  instructions: string | null;
  workDir: string;
  sceneIndex: number;
}

export interface NarrationResult {
  file: string;
  engine: "groq" | "edge";
}

function run(binary: string, args: string[], timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 60_000) stderr = stderr.slice(-30_000);
    });
    child.on("error", reject);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(`${path.basename(binary)} exited ${code}: ${stderr.slice(-400)}`));
    });
  });
}

const ORPHEUS_VOICE: Record<string, string> = {
  ava: "hannah",
  noah: "troy",
  isla: "hannah",
  oliver: "troy",
  maya: "hannah",
  luca: "troy",
  sora: "hannah",
  amara: "hannah",
};

/**
 * Neural voices — Orpheus especially — insert long, dramatic pauses around
 * commas and numbers, which can stretch a 20-second script to 26 seconds. The
 * renderer plans the timeline from the real audio length, so trimming edge
 * silence and squeezing overlong gaps first keeps the narration natural *and*
 * close to the requested duration.
 */
const SPEECH_TIGHTEN_FILTER = [
  "silenceremove=stop_periods=-1:stop_duration=0.35:stop_threshold=-40dB:stop_silence=0.16",
  "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-45dB",
  "areverse",
  "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-45dB",
  "areverse",
].join(",");

async function tightenSpeech(
  file: string,
  workDir: string,
  sceneIndex: number,
): Promise<string> {
  if (!FFMPEG_PATH) return file;
  const output = path.join(workDir, `speech-${sceneIndex}.wav`);
  try {
    await run(FFMPEG_PATH, [
      "-y",
      "-i",
      file,
      "-af",
      SPEECH_TIGHTEN_FILTER,
      "-c:a",
      "pcm_s16le",
      output,
    ]);
    return output;
  } catch (error) {
    console.warn(
      `[audio] silence tightening failed, keeping raw narration: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return file;
  }
}

async function groqNarration(request: NarrationRequest): Promise<NarrationResult> {
  const chunks = chunkForSpeech(request.text);
  const parts: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const bytes = await groqSpeech(chunks[index], {
      model: GROQ_TTS_MODEL,
      voice:
        ORPHEUS_VOICE[(request.voice ?? "").toLowerCase()] ?? GROQ_TTS_VOICE,
    });
    const part = path.join(request.workDir, `voice-${request.sceneIndex}-${index}.wav`);
    await fs.writeFile(part, bytes);
    parts.push(part);
  }

  if (parts.length === 0) throw new Error("Empty narration");
  if (parts.length === 1) return { file: parts[0], engine: "groq" };

  const joined = path.join(request.workDir, `voice-${request.sceneIndex}.wav`);
  const listPath = `${joined}.concat.txt`;
  await fs.writeFile(
    listPath,
    parts.map((file) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"),
    "utf8",
  );
  try {
    await run(FFMPEG_PATH as string, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c:a",
      "pcm_s16le",
      joined,
    ]);
  } finally {
    await fs.rm(listPath, { force: true }).catch(() => undefined);
  }
  return { file: joined, engine: "groq" };
}

async function edgeNarration(request: NarrationRequest): Promise<NarrationResult> {
  const bytes = await edgeSpeech(request.text, {
    language: request.language,
    voice: request.voice,
    instructions: request.instructions,
  });
  const file = path.join(request.workDir, `voice-${request.sceneIndex}.mp3`);
  await fs.writeFile(file, bytes);
  return { file, engine: "edge" };
}

async function tightened(
  result: Promise<NarrationResult>,
  request: NarrationRequest,
): Promise<NarrationResult> {
  const narration = await result;
  return {
    ...narration,
    file: await tightenSpeech(narration.file, request.workDir, request.sceneIndex),
  };
}

export async function synthesiseNarration(
  request: NarrationRequest,
): Promise<NarrationResult | null> {
  if (ttsMode === "none") return null;
  if (!request.text.trim()) return null;

  const english = request.language.toLowerCase().startsWith("en");

  if (ttsMode === "edge" || !english) {
    try {
      return await tightened(edgeNarration(request), request);
    } catch (error) {
      console.warn(
        `[audio] edge narration failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (ttsMode === "edge") return null;
    }
  }

  try {
    return await tightened(groqNarration(request), request);
  } catch (error) {
    console.warn(
      `[audio] groq narration failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    // Orpheus has a small daily quota. Fall back to the free Edge voices
    // rather than dropping narration (silent video) for the rest of the day.
    try {
      return await tightened(edgeNarration(request), request);
    } catch (fallbackError) {
      console.warn(
        `[audio] edge fallback failed: ${
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        }`,
      );
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Background music
// ---------------------------------------------------------------------------

type Mood = "calm" | "upbeat" | "cinematic" | "lofi";

const MOOD_CHORDS: Record<Mood, { notes: number[]; tremolo: number; cutoff: number }> = {
  calm: { notes: [174.61, 220.0, 261.63], tremolo: 0.16, cutoff: 1600 },
  upbeat: { notes: [261.63, 329.63, 392.0], tremolo: 1.6, cutoff: 3200 },
  cinematic: { notes: [130.81, 196.0, 261.63], tremolo: 0.1, cutoff: 1200 },
  lofi: { notes: [146.83, 174.61, 220.0], tremolo: 0.5, cutoff: 1400 },
};

export function musicMood(name: string | null | undefined): Mood | null {
  const normalized = (name ?? "").toLowerCase();
  if (!normalized || normalized === "none") return null;
  if (normalized.includes("up")) return "upbeat";
  if (normalized.includes("cine")) return "cinematic";
  if (normalized.includes("lofi") || normalized.includes("lo-fi")) return "lofi";
  if (normalized.includes("calm") || normalized.includes("ambient")) return "calm";
  return "calm";
}

/** Builds a short, loopable ambient bed for the built-in track names. */
export async function buildMusicBed(
  name: string,
  workDir: string,
  seconds: number,
): Promise<string | null> {
  if (!FFMPEG_PATH) return null;
  const mood = musicMood(name);
  if (!mood) return null;
  const chord = MOOD_CHORDS[mood];
  const expression = chord.notes
    .map((note, index) => `${(0.14 - index * 0.03).toFixed(2)}*sin(2*PI*${note}*t)`)
    .join("+");
  const file = path.join(workDir, `music-${mood}.wav`);
  try {
    await run(FFMPEG_PATH, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `aevalsrc=${expression}:s=44100:d=${Math.max(6, Math.min(30, Math.ceil(seconds))).toFixed(0)}`,
      "-af",
      `tremolo=f=${chord.tremolo}:d=0.35,aecho=0.8:0.9:110:0.22,lowpass=f=${chord.cutoff}`,
      "-c:a",
      "pcm_s16le",
      file,
    ]);
    return file;
  } catch (error) {
    console.warn(
      `[audio] music bed failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Podcast waveform
// ---------------------------------------------------------------------------

export function waveformFor(text: string, seed: number, count = 72): number[] {
  let state = (seed || 1) >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  const words = text.split(/\s+/).filter(Boolean);
  return Array.from({ length: count }, (_, index) => {
    const word = words[Math.floor((index / count) * Math.max(1, words.length))] ?? "";
    const emphasis = Math.min(1, word.length / 9);
    return Math.max(0.12, Math.min(1, 0.28 + random() * 0.5 + emphasis * 0.35));
  });
}
