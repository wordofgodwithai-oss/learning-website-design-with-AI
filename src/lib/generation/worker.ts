import "server-only";

import { readDb, withDb } from "@/lib/db";
import { syncJob } from "@/lib/generation/pipeline";

/**
 * Background job worker.
 *
 * Generation must not depend on the browser: the dashboard polls, but a user
 * can close the tab (or reload) while a render is queued. Without a worker the
 * job would sit in `queued` forever, and those leftovers also count against
 * `GOLPO_MAX_CONCURRENT_JOBS`, so every later request eventually fails with
 * 409. The worker advances every active job on a timer, starts its render, and
 * therefore also resumes work after a server restart.
 *
 * Jobs older than GOLPO_JOB_STALE_MS (default 6 hours) are failed on boot
 * instead of silently resurrected: a days-old prompt is usually noise, and
 * reviving it would spend provider quota and block new jobs.
 */

const TICK_MS = Math.max(250, Number(process.env.GOLPO_JOB_TICK_MS ?? 1_500));
const STALE_JOB_MS = Math.max(
  60_000,
  Number(process.env.GOLPO_JOB_STALE_MS ?? 6 * 60 * 60 * 1_000),
);

interface WorkerState {
  started: boolean;
  ticking: boolean;
  timer: NodeJS.Timeout | null;
}

// Next.js hot-reloads modules in development; keep one worker per process.
const globalWorker = globalThis as unknown as { __golpoWorker?: WorkerState };
const state: WorkerState = (globalWorker.__golpoWorker ??= {
  started: false,
  ticking: false,
  timer: null,
});

export async function startJobWorker(): Promise<void> {
  if (state.started) return;
  state.started = true;

  // Await the first pass so a generation request that triggers the worker
  // never races the stale-job sweep for its concurrency slot. A failure here
  // must not prevent the timer from starting.
  try {
    await failStaleJobs();
  } catch (error) {
    console.warn(
      `[worker] stale sweep failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  state.timer = setInterval(() => void tick(), TICK_MS);
  state.timer.unref?.();
  void tick();
  console.log(`[worker] job worker started (tick ${TICK_MS}ms, stale ${STALE_JOB_MS}ms)`);
}

/**
 * Idempotent entry point for route handlers. Returns immediately after the
 * worker has started and completed its first sweep.
 */
export async function ensureJobWorker(): Promise<void> {
  if (state.started) return;
  try {
    await startJobWorker();
  } catch (error) {
    console.warn(
      `[worker] could not start: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function tick(): Promise<void> {
  if (state.ticking) return;
  state.ticking = true;
  try {
    const db = await readDb();
    const active = db.jobs.filter(
      (job) => job.status === "queued" || job.status === "processing",
    );
    for (const job of active) {
      try {
        await syncJob(job.id, job.user_id);
      } catch (error) {
        console.warn(
          `[worker] could not advance ${job.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  } catch (error) {
    console.warn(
      `[worker] tick failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    state.ticking = false;
  }
}

/** Marks jobs abandoned by a previous process as failed so their slots free up. */
async function failStaleJobs(): Promise<void> {
  const cutoff = Date.now() - STALE_JOB_MS;
  const interrupted = "Interrupted by a server restart. Generate again to retry.";

  const stale = await withDb((db) => {
    const ids: string[] = [];
    for (const job of db.jobs) {
      if (job.status !== "queued" && job.status !== "processing") continue;
      const createdAt = new Date(job.created_at).getTime();
      if (!Number.isFinite(createdAt) || createdAt >= cutoff) continue;

      job.status = "failed";
      job.stage = "failed";
      job.error = interrupted;
      job.updated_at = new Date().toISOString();
      ids.push(job.id);

      const video = job.video_id
        ? db.videos.find((row) => row.id === job.video_id)
        : null;
      if (video && video.status !== "ready") {
        video.status = "failed";
        video.error = interrupted;
        video.updated_at = job.updated_at;
      }
    }
    return ids;
  });

  if (stale.length > 0) {
    console.log(`[worker] failed ${stale.length} stale job(s) from a previous run`);
  }
}

/** Test/CLI hook: run one pass immediately. */
export async function runWorkerOnce(): Promise<void> {
  await tick();
}
