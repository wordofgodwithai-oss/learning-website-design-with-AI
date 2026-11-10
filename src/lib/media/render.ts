import "server-only";

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import {
  FFMPEG_PATH,
  FFPROBE_PATH,
  renderMode,
} from "@/lib/integrations";
import { scriptToScenes } from "@/lib/generation/script";
import { imageDataUrl, generateArtwork } from "@/lib/media/artwork";
import { localAsset } from "@/lib/media/assets";
import {
  buildMusicBed,
  synthesiseNarration,
  waveformFor,
} from "@/lib/media/audio";
import { renderRasterPoster, renderSceneFrame, type FrameExtras } from "@/lib/media/svg";
import { layoutFor, settingsFor } from "@/lib/media/theme";
import { MEDIA_DIR, posterFilePath, videoFilePath } from "@/lib/media/store";
import type { Video } from "@/lib/types";

/**
 * Local render pipeline: storyboard frames → PNG (sharp) → MP4 (FFmpeg).
 *
 * Every field of the generate request is honoured:
 *
 * | Request field            | Effect here                                  |
 * | ------------------------ | -------------------------------------------- |
 * | engine / style           | theme + layout (`theme.ts`)                  |
 * | use_color                | monochrome palettes                          |
 * | pacing / timing          | narration length estimate + reveal speed      |
 * | skip_animation           | single static frame per scene                |
 * | kind=podcast             | waveform episode instead of illustrations     |
 * | avatar_renderer          | drawn/custom presenter overlay                |
 * | own_narration_*          | user video PiP / split / fullscreen           |
 * | media_files / user_*     | images or extracted frames in the panel       |
 * | custom_music_url         | mixed under narration                         |
 * | background_track         | synthesised ambient bed                       |
 * | logo_url / watermark     | baked into every frame                        |
 * | video_orientation        | 16:9, 9:16 or 1:1 canvas                      |
 * | language / voice         | Groq Orpheus (English) or Edge voices         |
 *
 * Scene artwork comes from a free image provider when one is configured
 * (`artwork.ts`) and falls back to the vector doodles in `illustration.ts`.
 */

const FPS = 30;
const SCENE_TAIL_SECONDS = 0.35;
const MIN_SCENE_SECONDS = 2;
const REVEAL_SECONDS = 1.5;
const REVEAL_FPS = 12;

const WORDS_PER_SECOND: Record<string, number> = { slow: 2.1, normal: 2.4, fast: 3.0 };

/**
 * v2 `pen_animation_style` controls how long the artwork wipe runs. Unknown
 * values deliberately keep the default rather than disabling the animation.
 */
function penReveal(style: string | null | undefined): { enabled: boolean; factor: number } {
  const key = (style ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (["none", "off", "instant", "disabled", "no animation"].includes(key)) {
    return { enabled: false, factor: 0 };
  }
  if (key.includes("slow") || key.includes("detailed")) return { enabled: true, factor: 1.6 };
  if (key.includes("fast") || key.includes("quick")) return { enabled: true, factor: 0.55 };
  return { enabled: true, factor: 1 };
}

export interface RenderResult {
  videoPath: string;
  posterPath: string;
  hadAudio: boolean;
  sceneCount: number;
  artwork: "ai" | "media" | "doodle" | "none";
  narration: "groq" | "edge" | "silent";
  music: "custom" | "generated" | "none";
  pip: boolean;
}

interface RunResult {
  stdout: string;
  stderr: string;
}

function run(binary: string, args: string[], timeoutMs = 300_000): Promise<RunResult> {
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

function estimateSeconds(narration: string, pacing: string): number {
  const words = narration.split(/\s+/).filter(Boolean).length;
  const rate = WORDS_PER_SECOND[pacing] ?? WORDS_PER_SECOND.normal;
  return Math.max(MIN_SCENE_SECONDS, words / rate);
}

function concatEntry(file: string): string {
  return `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
}

function encodeArgs(
  pattern: string,
  audio: string | null,
  seconds: number,
  output: string,
  options: { fade: boolean; tempo?: number },
): string[] {
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
  // A draft that runs a few percent long is fitted with a small tempo change
  // instead of cutting narration mid-sentence. atempo keeps the pitch, and the
  // same knob slows narration slightly when the script runs short. apad fills
  // the scene tail with silence so the audio and video streams end together
  // (otherwise concat leaves a shorter audio track).
  const tempo =
    options.tempo && Math.abs(options.tempo - 1) > 0.001
      ? Math.min(1.25, Math.max(0.9, options.tempo))
      : 1;
  const filters = [tempo !== 1 ? `atempo=${tempo.toFixed(3)}` : null, "apad"].filter(Boolean);
  const stretch = ["-af", filters.join(",")];
  const fade =
    options.fade && seconds > 1.2
      ? `,fade=t=in:st=0:d=0.4,fade=t=out:st=${(seconds - 0.4).toFixed(2)}:d=0.4`
      : "";
  // Image sequences are shorter than the scene, so clone the final drawn
  // frame for the remaining narration before trimming to the exact duration.
  const padding = [
    "-vf",
    `tpad=stop_mode=clone:stop_duration=${Math.max(seconds, 1).toFixed(3)}${fade}`,
  ];
  const source = ["-framerate", String(REVEAL_FPS), "-i", pattern];

  if (audio) {
    return [
      "-y",
      ...source,
      "-i",
      audio,
      "-t",
      seconds.toFixed(3),
      ...padding,
      ...video,
      ...stretch,
      ...sound,
      output,
    ];
  }
  return [
    "-y",
    ...source,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-t",
    seconds.toFixed(3),
    ...padding,
    ...video,
    ...sound,
    output,
  ];
}

/** Scales uploaded images to the illustration panel and returns a data URI. */
async function panelImage(source: string, width: number, height: number, workDir: string, key: string): Promise<string | null> {
  try {
    const file = path.join(workDir, `media-${key}.jpg`);
    await sharp(source)
      .rotate()
      .resize(Math.round(width), Math.round(height), { fit: "cover", position: "centre" })
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(file);
    const bytes = await fs.readFile(file);
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

async function videoFrame(source: string, workDir: string, key: string): Promise<string | null> {
  if (!FFMPEG_PATH) return null;
  const file = path.join(workDir, `frame-${key}.jpg`);
  try {
    const duration = await probeDuration(source);
    const at = duration > 2 ? Math.min(2, duration / 3) : 0.2;
    await run(FFMPEG_PATH, [
      "-y",
      "-ss",
      at.toFixed(2),
      "-i",
      source,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      file,
    ]);
    return file;
  } catch {
    return null;
  }
}

function pipOverlayArgs(
  base: string,
  overlay: string,
  width: number,
  height: number,
  seconds: number,
  position: string,
  size: string,
  mode: string,
  output: string,
): string[] {
  const fraction = size === "large" ? 0.42 : size === "small" ? 0.22 : 0.32;
  const scaleWidth =
    mode === "fullscreen" ? width : Math.round(width * (mode === "split" ? fraction + 0.12 : fraction));
  const margin = Math.round(width * 0.028);
  const x =
    position.includes("left") || mode === "split"
      ? margin
      : `main_w-overlay_w-${margin}`;
  const y = position.includes("top") ? margin : `main_h-overlay_h-${margin}`;

  const filter =
    mode === "fullscreen"
      ? `[1:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[pip];[0:v][pip]overlay=0:0[v]`
      : `[1:v]scale=${scaleWidth}:-2,setsar=1[pip];[0:v][pip]overlay=${x}:${y}:shortest=1[v]`;

  return [
    "-y",
    "-i",
    base,
    // The webcam clip is usually shorter than the narration; loop it and cap
    // the output at the rendered video's own length.
    "-stream_loop",
    "-1",
    "-i",
    overlay,
    "-t",
    Math.max(1, seconds).toFixed(3),
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    output,
  ];
}

async function overlayOwnNarration(
  input: string,
  narrationFile: string,
  width: number,
  height: number,
  settings: ReturnType<typeof settingsFor>,
  workDir: string,
  output: string,
): Promise<boolean> {
  if (!FFMPEG_PATH || !settings.ownNarration) return false;
  const position = settings.ownNarration.position;
  const size = settings.ownNarration.splitSize;
  const mode = settings.ownNarration.mode;
  void workDir;
  try {
    const seconds = await probeDuration(input);
    await run(
      FFMPEG_PATH,
      pipOverlayArgs(input, narrationFile, width, height, seconds, position, size, mode, output),
      600_000,
    );
    return true;
  } catch (error) {
    console.warn(
      `[render] PiP overlay failed, keeping the board: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

async function mixFinal(
  input: string,
  output: string,
  options: { music: string | null; seconds: number; fade: boolean },
): Promise<void> {
  if (!FFMPEG_PATH) throw new Error("FFmpeg is not available.");
  const args = ["-y", "-i", input];
  if (options.music) args.push("-stream_loop", "-1", "-i", options.music);

  const fadeOutStart = Math.max(0, options.seconds - 0.6);

  if (options.music) {
    const filter = [
      `[0:a]afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=0.6[voice]`,
      `[1:a]volume=0.14,afade=t=in:st=0:d=0.8[bed]`,
      `[voice][bed]amix=inputs=2:duration=first:dropout_transition=0[a]`,
    ].join(";");
    args.push(
      "-filter_complex",
      filter,
      "-map",
      "0:v",
      "-map",
      "[a]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      // The music bed is looped infinitely, so cap the mux at the video's own
      // duration instead of `-shortest` (which would cut the picture at the
      // end of the slightly shorter voice track).
      "-t",
      options.seconds.toFixed(3),
      "-movflags",
      "+faststart",
      output,
    );
  } else {
    args.push(
      "-af",
      `afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=0.6`,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      output,
    );
  }

  await run(FFMPEG_PATH, args, 600_000);
}

export async function renderVideo(video: Video): Promise<RenderResult> {
  if (renderMode !== "ffmpeg" || !FFMPEG_PATH || !FFPROBE_PATH) {
    throw new Error("FFmpeg renderer is not available in this environment.");
  }

  const settings = settingsFor(video);
  const layout = layoutFor(settings.orientation);
  const scenes =
    video.scenes && video.scenes.length > 0
      ? video.scenes
      : scriptToScenes(video.script ?? video.title, video.duration_seconds);

  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const workDir = path.join(MEDIA_DIR, `.work-${video.id}-${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  let hadAudio = false;
  let narrationEngine: RenderResult["narration"] = "silent";
  let artworkSource: RenderResult["artwork"] = "none";
  let pipUsed = false;

  try {
    // Shared assets -------------------------------------------------------
    const logoDataUrl = settings.logo
      ? await imageDataUrl(await localAsset(settings.logo.url))
      : null;

    const avatarDataUrl = settings.avatar?.imageUrl
      ? await panelImage(
          (await localAsset(settings.avatar.imageUrl)) ?? "",
          layout.presenter.width,
          layout.presenter.height,
          workDir,
          "avatar",
        )
      : null;

    const mediaFiles = settings.media.length > 0 ? settings.media : [];
    const mediaPaths: string[] = [];
    for (let index = 0; index < mediaFiles.length; index += 1) {
      const entry = mediaFiles[index];
      // `media_file_use_as_is: false` keeps the upload as a reference only; a
      // generated illustration is used for the panel instead.
      if (entry.useAsIs === false) continue;
      const local = await localAsset(entry.url);
      if (!local) continue;
      if (entry.type.startsWith("video") || /\.(mp4|mov|webm|mkv)$/i.test(entry.url)) {
        const frame = await videoFrame(local, workDir, `src-${index}`);
        if (frame) mediaPaths.push(frame);
      } else if (entry.type.startsWith("image") || /\.(png|jpe?g|webp)$/i.test(entry.url)) {
        mediaPaths.push(local);
      }
    }

    const segments: string[] = [];
    let firstArtwork: string | null = null;
    let totalSeconds = 0;

    // Narration first ------------------------------------------------------
    // Synthesising before any frame is drawn lets the timeline be balanced
    // against the exact narration length: a script that runs a little short is
    // spread across every scene instead of freezing one frame at the end.
    const timeline: Array<{
      audioPath: string | null;
      engine: "groq" | "edge" | null;
      seconds: number;
    }> = [];

    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      let audioPath: string | null = null;
      let engine: "groq" | "edge" | null = null;
      let seconds = estimateSeconds(scene.narration, settings.pacing);

      const narration = await synthesiseNarration({
        text: scene.narration,
        language: video.language,
        voice: settings.voice.name,
        instructions: settings.voice.instructions,
        workDir,
        sceneIndex: index,
      });

      if (narration) {
        const probed = await probeDuration(narration.file);
        if (probed > 0.2) {
          audioPath = narration.file;
          engine = narration.engine;
          seconds = probed + SCENE_TAIL_SECONDS;
        }
      }

      timeline.push({ audioPath, engine, seconds });
    }

    const requestedSeconds = Math.max(1, video.duration_seconds);
    const plannedSeconds = timeline.reduce((total, entry) => total + entry.seconds, 0);

    if (timeline.some((entry) => entry.engine)) {
      const spokenWords = scenes.reduce(
        (total, scene) => total + scene.narration.split(/\s+/).filter(Boolean).length,
        0,
      );
      const speechSeconds = timeline.reduce(
        (total, entry) => total + Math.max(0, entry.seconds - SCENE_TAIL_SECONDS),
        0,
      );
      if (spokenWords > 0 && speechSeconds > 0) {
        console.log(
          `[render] ${video.id} narration: ${spokenWords} words in ${speechSeconds.toFixed(
            1,
          )}s (${(spokenWords / speechSeconds).toFixed(2)} words/s)`,
        );
      }
    }
    let tempo = 1;
    if (plannedSeconds > 0) {
      const ratio = plannedSeconds / requestedSeconds;
      tempo = Math.min(1.25, Math.max(0.9, ratio));
      if (Math.abs(tempo - 1) > 0.005) {
        for (const entry of timeline) entry.seconds /= tempo;
        console.log(
          `[render] ${video.id} narration ran ${plannedSeconds.toFixed(1)}s; adjusting pace ${
            ((tempo - 1) * 100).toFixed(1)
          }% to fit ${requestedSeconds}s`,
        );
      }
    }

    // If the pace adjustment was clamped, spread any remaining shortfall
    // across the scenes rather than freezing one frame at the end.
    const adjustedSeconds = timeline.reduce((total, entry) => total + entry.seconds, 0);
    if (adjustedSeconds > 0 && adjustedSeconds < requestedSeconds - 0.05) {
      const scale = requestedSeconds / adjustedSeconds;
      for (const entry of timeline) entry.seconds *= scale;
      console.log(
        `[render] ${video.id} narration ran ${adjustedSeconds.toFixed(1)}s; spreading ${(
          requestedSeconds - adjustedSeconds
        ).toFixed(1)}s across ${timeline.length} scenes`,
      );
    }

    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      const { audioPath, engine, seconds } = timeline[index];
      if (engine) {
        hadAudio = true;
        narrationEngine = engine;
      }

      // Artwork -----------------------------------------------------------
      const panelWidth = layout.art.width - 40;
      const panelHeight = layout.art.height - 40;
      let artwork: string | null = null;

      if (!video.is_audio_only) {
        const userMedia = mediaPaths.length > 0 ? mediaPaths[index % mediaPaths.length] : null;
        if (userMedia) {
          artwork = await panelImage(userMedia, panelWidth, panelHeight, workDir, `scene-${index}`);
          if (artwork) artworkSource = "media";
        }
        if (!artwork) {
          const generated = await generateArtwork({
            description: `${scene.visual}. ${scene.narration}`,
            style: settings.style,
            engine: settings.engine === "golpo_sketch" ? "golpo_sketch" : "golpo_canvas",
            useColor: settings.useColor,
            seed: (index + 1) * 7919,
            width: panelWidth,
            height: panelHeight,
            characters: settings.characters,
            model: settings.imageGenerationModel,
          });
          if (generated.dataUrl) {
            artwork = generated.dataUrl;
            artworkSource = "ai";
          }
        }
      }
      if (index === 0 && artwork) firstArtwork = artwork;

      const extras: FrameExtras = {
        artwork,
        logoDataUrl,
        presenterDataUrl: avatarDataUrl,
        waveform: video.is_audio_only
          ? waveformFor(scene.narration, index + 1, 72)
          : null,
        chapter: video.is_audio_only ? scene.visual.slice(0, 42) : null,
      };

      // Frames --------------------------------------------------------------
      const pen = penReveal(settings.penAnimationStyle);
      const animate = !settings.skipAnimation && pen.enabled;
      const revealSeconds = animate
        ? Math.min(REVEAL_SECONDS * pen.factor, Math.max(0.7, seconds * 0.22 * pen.factor))
        : 0;
      const frameCount = animate
        ? Math.max(2, Math.round(revealSeconds * REVEAL_FPS))
        : 1;

      for (let step = 0; step < frameCount; step += 1) {
        const progress = frameCount === 1 ? 1 : step / (frameCount - 1);
        const framePath = path.join(
          workDir,
          `frame-${String(index).padStart(2, "0")}-${String(step).padStart(3, "0")}.png`,
        );
        await sharp(
          Buffer.from(renderSceneFrame(video, scene, index, scenes.length, progress, extras)),
        )
          .png()
          .toFile(framePath);
      }

      const pattern = path.join(workDir, `frame-${String(index).padStart(2, "0")}-%03d.png`);
      const segment = path.join(workDir, `scene-${index}.mp4`);
      await run(
        FFMPEG_PATH,
        encodeArgs(pattern, audioPath, seconds, segment, { fade: false, tempo }),
      );
      segments.push(segment);
      totalSeconds += seconds;
    }

    if (artworkSource === "none" && !video.is_audio_only) artworkSource = "doodle";

    // Concat ---------------------------------------------------------------
    const listPath = path.join(workDir, "concat.txt");
    await fs.writeFile(listPath, segments.map(concatEntry).join("\n"), "utf8");
    const concatenated = path.join(workDir, "concat.mp4");
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
      concatenated,
    ]);

    // PiP ------------------------------------------------------------------
    let current = concatenated;
    if (settings.ownNarration) {
      const pipFile = await localAsset(settings.ownNarration.url);
      if (pipFile) {
        const withPip = path.join(workDir, "pip.mp4");
        pipUsed = await overlayOwnNarration(
          current,
          pipFile,
          layout.width,
          layout.height,
          settings,
          workDir,
          withPip,
        );
        if (pipUsed) current = withPip;
      }
    }

    // Music + fades --------------------------------------------------------
    let music: string | null = null;
    let musicSource: RenderResult["music"] = "none";
    if (settings.music?.url) {
      music = await localAsset(settings.music.url);
      if (music) musicSource = "custom";
    }
    if (!music && settings.music?.name) {
      music = await buildMusicBed(settings.music.name, workDir, totalSeconds);
      if (music) musicSource = "generated";
    }

    const outputPath = videoFilePath(video.id);
    const probedTotal = (await probeDuration(current)) || totalSeconds;
    await mixFinal(current, outputPath, { music, seconds: probedTotal, fade: true });

    // Poster ---------------------------------------------------------------
    const outputPoster = posterFilePath(video.id);
    await sharp(
      Buffer.from(
        renderRasterPoster(video, {
          artwork: firstArtwork,
          logoDataUrl,
          presenterDataUrl: avatarDataUrl,
          waveform: video.is_audio_only
            ? waveformFor(scenes[0]?.narration ?? video.title, 1, 72)
            : null,
          chapter: video.is_audio_only ? (scenes[0]?.visual ?? video.title).slice(0, 42) : null,
        }),
      ),
    )
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(outputPoster);

    return {
      videoPath: outputPath,
      posterPath: outputPoster,
      hadAudio,
      sceneCount: scenes.length,
      artwork: artworkSource,
      narration: narrationEngine,
      music: musicSource,
      pip: pipUsed,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
