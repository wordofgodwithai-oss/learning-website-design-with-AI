import "server-only";

import { withDb, readDb, nowIso } from "@/lib/db";
import { jobId as newJobId, videoId as newVideoId } from "@/lib/ids";
import { num, clamp } from "@/lib/http";
import type { Database, Job, User, Video } from "@/lib/types";
import type { NormalizedGenerationRequest } from "@/lib/generation/request";
import { normalizeGenerationInput, validateGenerationInput } from "@/lib/generation/request";
import { buildScript } from "@/lib/generation/script";
import { concurrentGeneration, validationError } from "@/lib/generation/errors";
import { languageName } from "@/lib/generation/config";

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

/**
 * Creates the job + placeholder video rows and returns immediately. The client
 * then polls /api/generate/poll exactly like the real dashboard.
 */
export async function startGeneration(
  user: User,
  input: NormalizedGenerationRequest,
): Promise<JobSnapshot> {
  validateGenerationInput(input);

  const scriptResult = buildScript({
    prompt: input.prompt,
    durationSeconds: input.durationSeconds,
    kind: input.kind,
    scriptText: input.scriptOnlyText,
    displayLanguage: input.displayLanguage,
  });

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
        video_url: null,
        poster_url: null,
        watermark: input.forceWatermark || input.includeWatermark,
        is_audio_only: input.isAudioOnly,
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
      },
      variant_video_ids: [],
      is_script_generation: input.justReturnScript,
      is_audio_only: input.isAudioOnly,
      created_at: now,
      updated_at: now,
      completes_at: createdAt + SIMULATED_RENDER_MS,
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
 */
export async function syncJob(jobId: string, userId: string): Promise<JobSnapshot | null> {
  return withDb((db) => {
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
      finalize(job, video, db);
    }

    return snapshot(job, video);
  });
}

function finalize(job: Job, video: Video | null, db: Database): void {
  const timestamp = nowIso();

  // Variants: one sibling video per requested language (REPORT.md §6 step 5).
  const variantLanguages = Array.isArray(job.request.variant_languages)
    ? (job.request.variant_languages as unknown[]).map(String).filter(Boolean)
    : [];
  const existingVariants = new Set(job.variant_video_ids);

  if (video) {
    video.status = "ready";
    video.video_url = `/api/media/${video.id}/preview`;
    video.poster_url = `/api/media/${video.id}/poster`;
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
