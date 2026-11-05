import "server-only";

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { chunkForSpeech, groqSpeech } from "@/lib/ai/groq";
import {
  FFMPEG_PATH,
  FFPROBE_PATH,
  GROQ_TTS_MODEL,
  GROQ_TTS_VOICE,
  renderMode,
  ttsMode,
} from "@/lib/integrations";
import { scriptToScenes } from "@/lib/generation/script";
import { renderRasterPoster, renderSceneFrame } from "@/lib/media/svg";
import { MEDIA_DIR, posterFilePath, videoFilePath } from "@/lib/media/store";
import type { Video } from "@/lib/types";

/**
 * Real renderer: storyboard frame → PNG (sharp) → MP4 (FFmpeg).
 *
 * Narration comes from Groq TTS when configured. Without a key (or if TTS
 * fails) the same frames are encoded with silent audio, so the output is still
 * a playable 1280x720 MP4. Scene timing follows the audio; silent timing is
 * derived from the word count at ~2.4 words/second.
 */

const FPS = 30;
const SCENE_TAIL_SECONDS = 0.35;
const MIN_SCENE_SECONDS = 2;

export interface RenderResult {
  videoPath: string;
  posterPath: string;
  hadAudio: boolean;
  sceneCount: number;
}

interface RunResult {
  stdout: string;
  stderr: string;
}

function run(binary: string, args: string[], timeoutMs = 180_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(binary)} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 200_000) stdout = stdout.slice(-100_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const tail = stderr.trim().split("\n").slice(-6).join(" | ");
      reject(new Error(`${path.basename(binary)} exited ${code}${tail ? `: ${tail}` : ""}`));
    });
  });
}

async function probeDuration(file: string): Promise<number> {
  if (!FFPROBE_PATH) return 0;
  const { stdout } = await run(FFPROBE_PATH, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

function estimateSeconds(narration: string): number {
  const words = narration.split(/\s+/).filter(Boolean).length;
  return Math.max(MIN_SCENE_SECONDS, words / 2.4);
}

function encodeArgs(frame: string, audio: string | null, seconds: number, output: string): string[] {
  const video = [
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "stillimage",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
  ];
  const sound = ["-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2"];

  if (audio) {
    return [
      "-y",
      "-loop",
      "1",
      "-framerate",
      String(FPS),
      "-i",
      frame,
      "-i",
      audio,
      "-t",
      seconds.toFixed(3),
      ...video,
      ...sound,
      "-shortest",
      output,
    ];
  }
  return [
    "-y",
    "-loop",
    "1",
    "-framerate",
    String(FPS),
    "-i",
    frame,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-t",
    seconds.toFixed(3),
    ...video,
    ...sound,
    output,
  ];
}

function concatEntry(file: string): string {
  return `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
}

/**
 * Groq's Orpheus voices cap a single request at 200 characters, so a scene is
 * synthesised in chunks and the WAV parts are joined into one track per scene.
 */
async function concatAudio(parts: string[], output: string): Promise<void> {
  if (!FFMPEG_PATH) throw new Error("FFmpeg is not available to join narration chunks.");
  const listPath = `${output}.concat.txt`;
  await fs.writeFile(listPath, parts.map(concatEntry).join("\n"), "utf8");
  try {
    await run(FFMPEG_PATH, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c:a",
      "pcm_s16le",
      output,
    ]);
  } finally {
    await fs.rm(listPath, { force: true }).catch(() => undefined);
  }
}

export async function renderVideo(video: Video): Promise<RenderResult> {
  if (renderMode !== "ffmpeg" || !FFMPEG_PATH || !FFPROBE_PATH) {
    throw new Error("FFmpeg renderer is not available in this environment.");
  }

  const scenes =
    video.scenes && video.scenes.length > 0
      ? video.scenes
      : scriptToScenes(video.script ?? video.title, video.duration_seconds);

  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const workDir = path.join(MEDIA_DIR, `.work-${video.id}-${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  let hadAudio = false;

  try {
    const segments: string[] = [];

    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      const framePath = path.join(workDir, `frame-${index}.png`);
      await sharp(Buffer.from(renderSceneFrame(video, scene, index, scenes.length)))
        .png()
        .toFile(framePath);

      let audioPath: string | null = null;
      let seconds = estimateSeconds(scene.narration);

      if (ttsMode === "groq" && scene.narration.trim()) {
        try {
          const chunks = chunkForSpeech(scene.narration);
          const parts: string[] = [];
          for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
            const bytes = await groqSpeech(chunks[chunkIndex], {
              model: GROQ_TTS_MODEL,
              voice: GROQ_TTS_VOICE,
            });
            const part = path.join(workDir, `voice-${index}-${chunkIndex}.wav`);
            await fs.writeFile(part, bytes);
            parts.push(part);
          }

          let voicePath = parts[0] ?? null;
          if (parts.length > 1) {
            voicePath = path.join(workDir, `voice-${index}.wav`);
            await concatAudio(parts, voicePath);
          }

          if (voicePath) {
            const probed = await probeDuration(voicePath);
            if (probed > 0.2) {
              audioPath = voicePath;
              seconds = probed + SCENE_TAIL_SECONDS;
              hadAudio = true;
            }
          }
        } catch (error) {
          console.warn(
            `[render] narration failed for scene ${index + 1}, using silence: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          audioPath = null;
        }
      }

      const segment = path.join(workDir, `scene-${index}.mp4`);
      await run(FFMPEG_PATH, encodeArgs(framePath, audioPath, seconds, segment));
      segments.push(segment);
    }

    const listPath = path.join(workDir, "concat.txt");
    await fs.writeFile(listPath, segments.map(concatEntry).join("\n"), "utf8");

    const outputPath = videoFilePath(video.id);
    await run(FFMPEG_PATH, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);

    const outputPoster = posterFilePath(video.id);
    await sharp(Buffer.from(renderRasterPoster(video)))
      .jpeg({ quality: 86, mozjpeg: true })
      .toFile(outputPoster);

    return {
      videoPath: outputPath,
      posterPath: outputPoster,
      hadAudio,
      sceneCount: scenes.length,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
