import "server-only";

import { randomUUID } from "node:crypto";

import { withDb, readDb, nowIso } from "@/lib/db";
import { jobId as newJobId, videoId as newVideoId } from "@/lib/ids";
import { num, clamp, str } from "@/lib/http";
import type { Database, Job, RenderSettings, User, Video } from "@/lib/types";
import type { NormalizedGenerationRequest } from "@/lib/generation/request";
import { normalizeGenerationInput, validateGenerationInput } from "@/lib/generation/request";
import { writeScript, translateScenes } from "@/lib/generation/script-provider";
import {
  concurrentGeneration,
  insufficientCredits,
  planFeatureRequired,
  validationError,
} from "@/lib/generation/errors";
import { languageName } from "@/lib/generation/config";
import { normaliseOrientation } from "@/lib/media/theme";
import { renderMode } from "@/lib/integrations";
import { estimateCredits, getBalance } from "@/lib/billing";
import { isFeatureUnlocked, type Feature } from "@/lib/features";

/**
 * Simulated render pipeline.
 *
 * Everything the dashboard depends on is real: jobs are persisted, polling
 * reports a monotonically increasing progress, a video row is created up front,
 * language variants spawn sibling videos, and failures surface identically.
 * Only the actual media synthesis is simulated.
 *
 * TODO(REAL-GENERATION): replace `simulateRender` with a call to the render
 * backend. The production client posts multipart to /api/generate and polls
 * /api/generate/poll for up to 10 minutes when `kind === "unknown"`
 * (REPORT.md section 6). Keep `startGeneration` / `syncJob` signatures.
 */

const SIMULATED_RENDER_MS = Math.max(
  2_000,
  num(process.env.GOLPO_SIMULATED_RENDER_MS, process.env.NODE_ENV === "test" ? 500 : 14_000),
);

const MAX_CONCURRENT_JOBS = Math.max(1, num(process.env.GOLPO_MAX_CONCURRENT_JOBS, 5));

/**
 * Renders owned by this process. Kept on globalThis so a dev hot reload does
 * not forget a render that is still writing files, and paired with a DB token
 * (below) so ownership also survives module duplication.
 */
const globalRenders = globalThis as unknown as { __golpoActiveRenders?: Set<string> };
const activeRenders = (globalRenders.__golpoActiveRenders ??= new Set<string>());
const RENDER_STALE_MS = 10 * 60 * 1000;

const STAGE_STEPS = [
  { at: 0, label: "queued" },
  { at: 0.05, label: "writing_script" },
  { at: 0.16, label: "generating_scenes" },
  { at: 0.42, label: "synthesising_narration" },
  { at: 0.66, label: "rendering_visuals" },
  { at: 0.85, label: "encoding" },
  { at: 0.96, label: "finalising" },
] as const;

const PODCAST_STAGES = [
  { at: 0, label: "queued" },
  { at: 0.06, label: "writing_script" },
  { at: 0.24, label: "synthesising_voices" },
  { at: 0.56, label: "mixing_audio" },
  { at: 0.82, label: "mastering" },
  { at: 0.96, label: "finalising" },
] as const;

export interface JobSnapshot {
  success: true;
  job_id: string;
  video_id: string | null;
  status: Job["status"];
  stage: string;
  progress: number;
  kind: Job["kind"];
  ready: boolean;
  script: string | null;
  error: string | null;
  video: Video | null;
  variant_video_ids: string[];
  created_at: string;
  elapsed_ms: number;
}

function stageFor(kind: Job["kind"], ratio: number): string {
  const steps = kind === "podcast" ? PODCAST_STAGES : STAGE_STEPS;
  let label: string = steps[0].label;
  for (const step of steps) {
    if (ratio >= step.at) label = step.label;
  }
  return label;
}

function titleFrom(input: NormalizedGenerationRequest): string {
  const source = input.prompt.trim() || input.scriptOnlyText?.trim() || "Untitled video";
  const firstLine = source.split(/\n|(?<=[.!?])\s/)[0].replace(/[.!?]+$/, "").trim();
  const title = firstLine.charAt(0).toUpperCase() + firstLine.slice(1);
  return title.length > 80 ? `${title.slice(0, 77)}...` : title;
}

function variantTitle(title: string, language: string): string {
  return `${title} (${languageName(language)})`;
}

/** Everything the renderer needs, resolved from the normalized request. */
function buildRenderSettings(
  input: NormalizedGenerationRequest,
  characters: RenderSettings["characters"],
): RenderSettings {
  const orientation = normaliseOrientation(str(input.raw.video_orientation));
  const background = str(input.raw.background_track);
  const avatarImage =
    str(input.raw.avatar_image_url) ||
    str(input.raw.custom_avatar_url) ||
    "";

  const media: RenderSettings["media"] = [
    ...input.userImages.map((url, index) => ({
      url,
      type: "image",
      description: input.userImagesDescription[index] ?? "",
    })),
    ...input.userVideos.map((url, index) => ({
      url,
      type: "video",
      description: input.userVideosDescription[index] ?? "",
    })),
    ...input.mediaFiles.map((url, index) => ({
      url,
      type: input.mediaFileTypes[index] ?? "image",
      description: input.mediaFileDescriptions[index] ?? "",
      useAsIs: input.mediaFileUseAsIs[index] ?? true,
    })),
  ];

  const narrationVideo =
    input.userVideos[0] ??
    input.mediaFiles.find((_, index) => (input.mediaFileTypes[index] ?? "").startsWith("video")) ??
    "";

  const music = input.customMusicUrl
    ? { url: input.customMusicUrl, name: input.musicName ?? null }
    : background && background !== "none"
      ? { url: null, name: background }
      : input.musicName && input.musicName !== "none"
        ? { url: null, name: input.musicName }
        : null;

  const avatar = input.avatarRenderer
    ? {
        renderer: input.avatarRenderer,
        presentation: input.avatarPresentationMode ?? "half_body",
        imageUrl: avatarImage || null,
      }
    : input.ownNarration
      ? {
          renderer: "whiteboard",
          presentation: "half_body",
          imageUrl: avatarImage || null,
        }
      : null;

  const ownNarration =
    input.ownNarration && narrationVideo
      ? {
          url: narrationVideo,
          mode: input.ownNarration.videoMode,
          position: input.ownNarration.pipPosition,
          splitSize: input.ownNarration.splitSize,
        }
      : null;

  return {
    engine: input.engine,
    style: input.style,
    orientation,
    useColor: input.useColor,
    pacing: input.pacing,
    timing: input.timing,
    penStyle: input.penStyle,
    imageStyle: input.imageStyle,
    imageGenerationModel: input.imageGenerationModel,
    penAnimationStyle: input.penAnimationStyle,
    characters,
    styleReference: input.styleReference,
    skipAnimation: input.skipAnimation,
    watermark: input.forceWatermark || input.includeWatermark,
    logo: input.logoUrl ? { url: input.logoUrl, placement: input.logoPlacement ?? "top_right" } : null,
    music,
    avatar,
    ownNarration,
    media,
    voice: { name: input.voiceName, instructions: input.voiceInstructions },
    scriptSource: null,
  };
}

/** Which plan-gated features a request actually uses. */
function requiredFeatures(input: NormalizedGenerationRequest): Feature[] {
  const features: Feature[] = [];
  if (input.kind === "podcast") features.push("podcast");
  if (input.variantLanguages.length > 0) features.push("multilingual");
  if (input.avatarRenderer) features.push("ai_presenter");
  if (input.ownNarration) features.push("own_narration");
  if (input.userImages.length || input.userVideos.length || input.mediaFiles.length) {
    features.push("user_media");
  }
  if (input.voiceInstructions) features.push("voice_instructions");
  if (input.logoUrl) features.push("logo_upload");
  if (input.customMusicUrl) features.push("custom_music");
  if (input.characters.length) features.push("character_consistency");
  if (input.durationSeconds > 300) features.push("longer_videos");
  if (input.justReturnScript) features.push("script_mode");
  return features;
}

/**
 * `characters` arrives either as saved-character ids (dashboard) or inline
 * objects (v2 API). Resolve both into the descriptor the artwork prompt uses.
 */
async function resolveCharacters(
  userId: string,
  raw: unknown[],
): Promise<RenderSettings["characters"]> {
  if (raw.length === 0) return [];

  const db = await readDb();
  const resolved: RenderSettings["characters"] = [];
  for (const entry of raw) {
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const name = str(record.name).trim();
      const description = str(record.description).trim();
      const imageUrl = str(record.image_url ?? record.imageUrl).trim() || null;
      if (name || description) {
        resolved.push({ name: name || "Character", description, imageUrl });
        continue;
      }
      // `{ id }` is how the dashboard batch API represents a selection.
      const objectId = str(record.id).trim();
      if (objectId) {
        const row = db.characters.find(
          (character) => character.id === objectId && character.user_id === userId,
        );
        if (row) {
          resolved.push({
            name: row.name,
            description: row.description,
            imageUrl: row.image_url,
          });
        }
        continue;
      }
    }

    const id = str(entry).trim();
    if (!id) continue;
    const row = db.characters.find(
      (character) => character.id === id && character.user_id === userId,
    );
    if (row) {
      resolved.push({ name: row.name, description: row.description, imageUrl: row.image_url });
    }
  }

  return resolved.slice(0, 8);
}

/**
 * Creates the job + placeholder video rows and returns immediately. The client
 * then polls /api/generate/poll exactly like the real dashboard.
 *
 * Billing: the ledger is debited in the same transaction that creates the job,
 * so a failed request never leaves a dangling charge. `local-unlimited` (or
 * GOLPO_UNLIMITED_DEV) skips both the entitlement check and the debit.
 */
export async function startGeneration(
  user: User,
  input: NormalizedGenerationRequest,
): Promise<JobSnapshot> {
  validateGenerationInput(input);

  const balance = await getBalance(user.id);
  for (const feature of requiredFeatures(input)) {
    if (!isFeatureUnlocked(feature, balance)) {
      throw planFeatureRequired(feature, balance.plan);
    }
  }

  const characters = await resolveCharacters(user.id, input.characters);

  const avatar = input.avatarRenderer
    ? input.characters.length
      ? "custom"
      : "stock"
    : "none";
  const cost = balance.unlimited
    ? 0
    : estimateCredits({
        durationSeconds: input.durationSeconds,
        isAudioOnly: input.isAudioOnly,
        avatar,
      });

  const scriptResult = await writeScript({
    prompt: input.prompt,
    durationSeconds: input.durationSeconds,
    kind: input.kind,
    scriptText: input.scriptOnlyText,
    displayLanguage: input.displayLanguage,
    fillIn: input.fillIn,
  });

  const renderSettings = {
    ...buildRenderSettings(input, characters),
    scriptSource: scriptResult.source,
  };

  const now = nowIso();
  const createdAt = Date.now();
  const videoId = input.justReturnScript ? null : newVideoId();
  const jobId = newJobId();

  return withDb((db) => {
    const active = db.jobs.filter(
      (job) =>
        job.user_id === user.id && (job.status === "queued" || job.status === "processing"),
    ).length;
    if (active >= MAX_CONCURRENT_JOBS) {
      throw concurrentGeneration();
    }

    if (!balance.unlimited && cost > 0) {
      const ledger = db.credits.find((row) => row.user_id === user.id);
      if (!ledger || ledger.credits < cost) throw insufficientCredits();
      ledger.credits -= cost;
    }

    if (videoId) {
      const video: Video = {
        id: videoId,
        user_id: user.id,
        job_id: jobId,
        title: titleFrom(input),
        status: "processing",
        kind: input.kind,
        engine: input.engine,
        style: input.style,
        image_style: input.imageStyle,
        pen_style: input.penStyle,
        language: input.language,
        display_language: input.displayLanguage,
        duration_seconds: input.durationSeconds,
        visibility: input.isPublic ? "public" : "private",
        script: scriptResult.script,
        scenes: scriptResult.scenes,
        video_url: null,
        poster_url: null,
        media_format: "svg",
        watermark: input.forceWatermark || input.includeWatermark,
        is_audio_only: input.isAudioOnly,
        render: renderSettings,
        variant_of: null,
        variant_language: null,
        error: null,
        created_at: now,
        updated_at: now,
      };
      db.videos.unshift(video);
    }

    const job: Job = {
      id: jobId,
      user_id: user.id,
      video_id: videoId,
      status: input.justReturnScript ? "script_ready" : "queued",
      stage: input.justReturnScript ? "script_ready" : "queued",
      progress: input.justReturnScript ? 100 : 0,
      kind: input.kind,
      script: scriptResult.script,
      error: null,
      request: {
        ...input.raw,
        prompt: input.prompt,
        kind: input.kind,
        engine: input.engine,
        style: input.style,
        image_style: input.imageStyle,
        pen_style: input.penStyle,
        durationSeconds: input.durationSeconds,
        language: input.language,
        display_language: input.displayLanguage,
        is_audio_only: input.isAudioOnly,
        just_return_script: input.justReturnScript,
        variant_languages: input.variantLanguages,
        variant_display_languages: input.variantDisplayLanguages,
        variant_new_scripts: input.variantNewScripts,
        script_source: scriptResult.source,
        script_model: scriptResult.model ?? null,
        credits_charged: cost,
      },
      variant_video_ids: [],
      is_script_generation: input.justReturnScript,
      is_audio_only: input.isAudioOnly,
      created_at: now,
      updated_at: now,
      completes_at: createdAt + SIMULATED_RENDER_MS,
      render_started_at: null,
    };
    db.jobs.unshift(job);

    return snapshot(job, videoId ? db.videos.find((v) => v.id === videoId) ?? null : null);
  });
}

function snapshot(job: Job, video: Video | null): JobSnapshot {
  return {
    success: true,
    job_id: job.id,
    video_id: job.video_id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    kind: job.kind,
    ready: job.status === "ready" || job.status === "script_ready",
    script: job.script,
    error: job.error,
    video,
    variant_video_ids: job.variant_video_ids,
    created_at: job.created_at,
    elapsed_ms: Date.now() - new Date(job.created_at).getTime(),
  };
}

/**
 * Advances the job to its current wall-clock state and persists it.
 * Safe to call concurrently: the whole read-modify-write runs inside withDb.
 *
 * When the real renderer is enabled, hitting 100% only *starts* the FFmpeg
 * render. Polling stays at 97% with stage `encoding` until the render finishes
 * and finalises the job in a separate transaction, so the database mutex is
 * never held while FFmpeg runs.
 */
export async function syncJob(jobId: string, userId: string): Promise<JobSnapshot | null> {
  let startRender = false;
  let renderToken: string | null = null;

  const result = await withDb((db) => {
    const job = db.jobs.find((row) => row.id === jobId && row.user_id === userId);
    if (!job) return null;
    const video = job.video_id
      ? db.videos.find((row) => row.id === job.video_id) ?? null
      : null;

    if (job.status === "ready" || job.status === "failed" || job.status === "script_ready") {
      return snapshot(job, video);
    }

    const startedAt = new Date(job.created_at).getTime();
    const total = Math.max(1, job.completes_at - startedAt);
    const ratio = clamp((Date.now() - startedAt) / total, 0, 1);

    job.stage = stageFor(job.kind, ratio);
    job.progress = Math.min(99, Math.round(ratio * 100));
    job.status = "processing";
    job.updated_at = nowIso();

    if (video) {
      video.status = "processing";
      video.updated_at = job.updated_at;
    }

    if (ratio >= 1) {
      if (renderMode !== "ffmpeg") {
        finalize(job, video, db, "svg");
      } else if (job.render_started_at && Date.now() - job.render_started_at > RENDER_STALE_MS) {
        // The process that started this render is gone (restart/crash). Do not
        // leave the job stuck at 97%: serve the storyboard instead.
        job.request.render_error = "render timed out; served storyboard";
        finalize(job, video, db, "svg");
      } else {
        if (!job.render_started_at) {
          // First caller claims the render. Every later sync (worker, polling,
          // another module instance) sees the token and leaves it alone.
          job.render_started_at = Date.now();
          job.render_token = randomUUID();
          renderToken = job.render_token;
          startRender = true;
        }
        job.stage = "encoding";
        job.progress = 97;
      }
    }

    return snapshot(job, video);
  });

  if (startRender && renderToken) void runRender(jobId, renderToken);
  return result;
}

/** Renders in the background; never throws into the caller. */
async function runRender(jobId: string, token: string): Promise<void> {
  if (activeRenders.has(jobId)) return;
  activeRenders.add(jobId);

  try {
    const db = await readDb();
    const job = db.jobs.find((row) => row.id === jobId);
    const video = job?.video_id ? db.videos.find((row) => row.id === job.video_id) : null;
    if (!job || !video) return;
    if (job.render_token && job.render_token !== token) return;

    // Lazy import keeps sharp/FFmpeg out of the bundle when storyboard mode is
    // active, and isolates a missing/broken binary to this one job.
    const { renderVideo } = await import("@/lib/media/render");
    const rendered = await renderVideo(video);

    let variants: string[] = [];
    await withDb((current) => {
      const currentJob = current.jobs.find((row) => row.id === jobId);
      const currentVideo = currentJob?.video_id
        ? current.videos.find((row) => row.id === currentJob.video_id)
        : null;
      if (!currentJob || !currentVideo || currentJob.status === "ready") return;
      currentJob.request.render_scenes = rendered.sceneCount;
      currentJob.request.render_audio = rendered.hadAudio;
      currentJob.request.render_artwork = rendered.artwork;
      currentJob.request.render_narration = rendered.narration;
      currentJob.request.render_music = rendered.music;
      currentJob.request.render_pip = rendered.pip;
      finalize(currentJob, currentVideo, current, "mp4");
      variants = [...currentJob.variant_video_ids];
    });

    // Language variants get their own narration, so they render in the
    // background after the main video is already playable.
    if (variants.length > 0) void renderVariants(variants);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[render] ${jobId} failed, serving storyboard: ${message}`);
    await withDb((current) => {
      const currentJob = current.jobs.find((row) => row.id === jobId);
      const currentVideo = currentJob?.video_id
        ? current.videos.find((row) => row.id === currentJob.video_id)
        : null;
      if (!currentJob || !currentVideo || currentJob.status === "ready") return;
      currentJob.request.render_error = message;
      finalize(currentJob, currentVideo, current, "svg");
    });
  } finally {
    activeRenders.delete(jobId);
  }
}

function finalize(
  job: Job,
  video: Video | null,
  db: Database,
  mediaFormat: "mp4" | "svg",
): void {  const timestamp = nowIso();

  // Variants: one sibling video per requested language (REPORT.md §6 step 5).
  const variantLanguages = Array.isArray(job.request.variant_languages)
    ? (job.request.variant_languages as unknown[]).map(String).filter(Boolean)
    : [];
  const existingVariants = new Set(job.variant_video_ids);

  if (video) {
    video.status = "ready";
    video.video_url = `/api/media/${video.id}/preview`;
    video.poster_url = `/api/media/${video.id}/poster`;
    video.media_format = mediaFormat;
    video.error = null;
    video.updated_at = timestamp;
  }

  for (const language of variantLanguages) {
    if (!video) break;
    if (job.variant_video_ids.length >= 10) break;
    const id = newVideoId();
    const variant: Video = {
      ...video,
      id,
      job_id: job.id,
      title: variantTitle(video.title, language),
      language,
      display_language: languageName(language),
      variant_of: video.id,
      variant_language: language,
      video_url: `/api/media/${id}/preview`,
      poster_url: `/api/media/${id}/poster`,
      // In storyboard mode the variant simply shares the parent preview. With
      // FFmpeg it needs its own narration, so it stays `processing` (and the
      // media route serves the parent until `renderVariants` finishes).
      status: mediaFormat === "svg" ? "ready" : "processing",
      error: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    db.videos.unshift(variant);
    if (!existingVariants.has(id)) job.variant_video_ids.push(id);
  }

  job.status = "ready";
  job.stage = "ready";
  job.progress = 100;
  job.updated_at = timestamp;
}

/**
 * Language variants are created when the parent finalises. Each one gets a
 * translated script (when the model is available) and its own render, because
 * narration must be in the variant's language.
 *
 * The variant stays `processing` until its own MP4 exists; the media route
 * serves the parent render in the meantime. A failed translation or render is
 * recorded on the row instead of silently shipping the wrong language.
 */
async function renderVariants(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      const db = await readDb();
      const variant = db.videos.find((row) => row.id === id);
      if (!variant || !variant.variant_language) continue;
      if (variant.status === "ready") continue;
      const parent = variant.variant_of
        ? db.videos.find((row) => row.id === variant.variant_of)
        : null;

      const { scenes, translated } = await translateScenes(
        variant.scenes ?? [],
        variant.variant_language,
        parent?.language,
      );
      if (!translated) {
        throw new Error(
          `Could not translate narration into ${languageName(variant.variant_language)}.`,
        );
      }

      const target: Video = {
        ...variant,
        status: "processing",
        scenes,
        script: scenes.map((scene) => scene.narration).join(" "),
        render: variant.render ? { ...variant.render, scriptSource: "variant" } : variant.render,
      };

      // Persist the translated script up front so the page can show it while
      // FFmpeg is still working.
      await withDb((current) => {
        const row = current.videos.find((entry) => entry.id === id);
        if (!row) return;
        row.status = "processing";
        row.scenes = scenes;
        row.script = target.script;
        row.error = null;
        row.updated_at = nowIso();
      });

      const { renderVideo } = await import("@/lib/media/render");
      await renderVideo(target);

      await withDb((current) => {
        const row = current.videos.find((entry) => entry.id === id);
        if (!row) return;
        row.scenes = scenes;
        row.script = target.script;
        row.video_url = `/api/media/${id}/preview`;
        row.poster_url = `/api/media/${id}/poster`;
        row.media_format = "mp4";
        row.status = "ready";
        row.error = null;
        row.updated_at = nowIso();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[render] variant ${id} failed: ${message}`);
      await withDb((current) => {
        const row = current.videos.find((entry) => entry.id === id);
        if (!row) return;
        row.status = "failed";
        row.error = message;
        row.updated_at = nowIso();
      });
    }
  }
}

/** Re-runs a finished job's request, optionally with overridden fields. */
export async function regenerateVideo(
  user: User,
  videoId: string,
  overrides: Record<string, unknown>,
): Promise<JobSnapshot> {
  const db = await readDb();
  const video = db.videos.find((row) => row.id === videoId && row.user_id === user.id);
  if (!video) throw validationError("Video not found.");
  const job = db.jobs.find((row) => row.id === video.job_id);

  const base = job?.request ?? {
    prompt: video.title,
    durationSeconds: video.duration_seconds,
    language: video.language,
    style: video.style,
    image_style: video.image_style,
    pen_style: video.pen_style,
  };

  const input = normalizeGenerationInput({ ...base, ...overrides, is_edit: true });
  return startGeneration(user, input);
}

export { SIMULATED_RENDER_MS };
