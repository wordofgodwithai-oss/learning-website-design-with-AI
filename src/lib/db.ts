import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import type { Database, CreditAccount, User } from "@/lib/types";
import { MOCK_INFINITE_CREDITS } from "@/lib/billing/constants";

const DATA_DIR = process.env.GOLPO_DATA_DIR
  ? path.resolve(process.env.GOLPO_DATA_DIR)
  : path.join(process.cwd(), ".data");

const DB_PATH = path.join(DATA_DIR, "db.json");

export const DEMO_USER_ID = "usr_local_demo";
export const DEMO_API_KEY =
  process.env.GOLPO_DEV_API_KEY ?? "glp_local_dev_key_change_me";

type Store = { db: Database | null; loading: Promise<Database> | null };

// Next.js hot-reloads route modules in dev; keep one store per process.
const globalStore = globalThis as unknown as { __golpoStore?: Store };
const store: Store = (globalStore.__golpoStore ??= { db: null, loading: null });

/** Serializes writes so concurrent route handlers cannot interleave. */
let writeQueue: Promise<unknown> = Promise.resolve();

function nowIso(): string {
  return new Date().toISOString();
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function creditsFor(user: Pick<User, "id" | "email" | "name">): CreditAccount {
  return {
    user_id: user.id,
    // TODO(REAL-BILLING): replace with the real ledger balance.
    credits: MOCK_INFINITE_CREDITS,
    plan: "local-unlimited",
    email: user.email,
    name: user.name,
    stripe_email: null,
    next_subscription_date: daysFromNow(3650),
    custom_logo_url: null,
    subscription_canceled: false,
    created_at: nowIso(),
    generation_preferences: null,
    experiment_assignment: "local_dev",
    watermark_add_on: true,
    lang_add_on: true,
    script_add_on: true,
    video_instruction_add_on: true,
    logo_add_on: true,
    team_add_on: true,
    api_add_on: true,
    longer_videos_add_on: true,
  };
}

function seed(): Database {
  const created = nowIso();
  const demoUser: User = {
    id: DEMO_USER_ID,
    email: "demo@golpo.local",
    name: "Local Dev",
    display_name: "Local Dev",
    provider: "dev",
    avatar_url: null,
    created_at: created,
    last_login_at: created,
  };

  const welcomeId = "vid_local_welcome";
  return {
    version: 1,
    users: [demoUser],
    credits: [creditsFor(demoUser)],
    videos: [
      {
        id: welcomeId,
        user_id: demoUser.id,
        job_id: null,
        title: "Welcome to Golpo Local",
        status: "ready",
        kind: "video",
        engine: "golpo_canvas",
        style: "whiteboard",
        image_style: "whiteboard",
        pen_style: null,
        language: "en",
        display_language: "English",
        duration_seconds: 20,
        visibility: "private",
        script:
          "Golpo Local is a working reconstruction of the Golpo AI dashboard. " +
          "Sign in, describe a video, and watch a simulated render finish. " +
          "Billing is mocked, so every feature is unlocked.",
        video_url: `/api/media/${welcomeId}/preview`,
        poster_url: `/api/media/${welcomeId}/poster`,
        watermark: false,
        is_audio_only: false,
        variant_of: null,
        variant_language: null,
        error: null,
        created_at: created,
        updated_at: created,
      },
    ],
    jobs: [],
    characters: [],
    styles: [],
    voice_clones: [],
    custom_music: [],
    playlists: [],
    api_keys: [
      {
        id: "key_local_dev",
        user_id: demoUser.id,
        name: "Local development key",
        prefix: DEMO_API_KEY.slice(0, 12),
        key_hash: createHash("sha256").update(DEMO_API_KEY).digest("hex"),
        created_at: created,
        last_used_at: null,
        revoked_at: null,
      },
    ],
    organizations: [
      {
        id: "org_local",
        name: "Local Studio",
        owner_id: demoUser.id,
        seat_count: 3,
        member_ids: [demoUser.id],
        created_at: created,
      },
    ],
    uploads: [],
    changelogs: [
      {
        id: "chg_local_1",
        version: "1.0.0",
        title: "Golpo Local is live",
        summary: "A local reconstruction of the Golpo AI dashboard and API.",
        body: {
          feature: [
            "Google and Microsoft sign-in are mocked, one click each",
            "Canvas and Sketch engines with the full style catalogue",
            "Simulated generation pipeline with real job polling",
            "Public API v1/v2 and an MCP endpoint",
          ],
        },
        released_at: created,
      },
    ],
    system_status: {
      force_show: false,
      force_hide: false,
      auto_detect_enabled: true,
      title: "Local development mode",
      message: "Billing and feature gating are mocked. Credits are infinite.",
      severity: "info",
    },
    admin_roles: [{ user_id: DEMO_USER_ID, role: "owner", permissions: ["*"] }],
    updated_at: created,
  };
}

async function persist(db: Database): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, DB_PATH);
}

async function load(): Promise<Database> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as Database;
    // Forward-compatible defaults for stores created by older builds.
    parsed.jobs ??= [];
    parsed.uploads ??= [];
    parsed.admin_roles ??= [];
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const fresh = seed();
    await persist(fresh);
    return fresh;
  }
}

async function ensure(): Promise<Database> {
  if (store.db) return store.db;
  if (!store.loading) {
    store.loading = load().then((db) => {
      store.db = db;
      return db;
    });
  }
  return store.loading;
}

/** Read-only snapshot. Callers must not mutate the returned object. */
export async function readDb(): Promise<Database> {
  return ensure();
}

/**
 * Read-modify-write inside a process-wide mutex, then atomically persist.
 * Every mutation in src/lib/repo.ts goes through this.
 */
export async function withDb<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
  const run = writeQueue.then(async () => {
    const db = await ensure();
    const result = await fn(db);
    db.updated_at = nowIso();
    await persist(db);
    return result;
  });
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export { creditsFor, nowIso };
