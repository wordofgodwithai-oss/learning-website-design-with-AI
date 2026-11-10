import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import type { Database, CreditAccount, User } from "@/lib/types";
import { MOCK_INFINITE_CREDITS } from "@/lib/billing/constants";
import { billingMode, unlimitedDevOverride } from "@/lib/integrations";

const DATA_DIR = process.env.GOLPO_DATA_DIR
  ? path.resolve(process.env.GOLPO_DATA_DIR)
  : path.join(process.cwd(), ".data");

const DB_PATH = path.join(DATA_DIR, "db.json");

export const DEMO_USER_ID = "usr_local_demo";
export const DEMO_API_KEY =
  process.env.GOLPO_DEV_API_KEY ?? "glp_local_dev_key_change_me";

type Store = { db: Database | null; loading: Promise<Database> | null };

/**
 * Next.js hot-reloads route modules in dev, which re-evaluates this module and
 * used to reset both the store and the write queue. Two module instances then
 * wrote `.data/db.json.<pid>.tmp` at the same time: one rename won, the other
 * failed with ENOENT and the request returned 500. Keep the state on
 * globalThis so every instance shares one queue, and give each write a unique
 * temp file so a retry can never collide with an in-flight write.
 */
const globalStore = globalThis as unknown as {
  __golpoDb?: { store: Store; queue: Promise<unknown> };
};
const dbState = (globalStore.__golpoDb ??= {
  store: { db: null, loading: null },
  queue: Promise.resolve(),
});
const store: Store = dbState.store;

/** Serialized writes survive hot reload via dbState.queue. */

function nowIso(): string {
  return new Date().toISOString();
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/** When true the ledger behaves like real money: new accounts start free. */
const stripeLedger = billingMode === "stripe" && !unlimitedDevOverride;

function creditsFor(user: Pick<User, "id" | "email" | "name">): CreditAccount {
  return {
    user_id: user.id,
    credits: stripeLedger ? 0 : MOCK_INFINITE_CREDITS,
    plan: stripeLedger ? "free" : "local-unlimited",
    email: user.email,
    name: user.name,
    stripe_email: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    subscription_status: stripeLedger ? null : "active",
    price_id: null,
    current_period_end: null,
    cancel_at_period_end: false,
    subscription_paused: false,
    next_subscription_date: stripeLedger ? null : daysFromNow(3650),
    custom_logo_url: null,
    subscription_canceled: false,
    created_at: nowIso(),
    generation_preferences: null,
    experiment_assignment: stripeLedger ? "stripe" : "local_dev",
    watermark_add_on: !stripeLedger,
    lang_add_on: !stripeLedger,
    script_add_on: !stripeLedger,
    video_instruction_add_on: !stripeLedger,
    logo_add_on: !stripeLedger,
    team_add_on: !stripeLedger,
    api_add_on: !stripeLedger,
    longer_videos_add_on: !stripeLedger,
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
        scenes: null,
        video_url: `/api/media/${welcomeId}/preview`,
        poster_url: `/api/media/${welcomeId}/poster`,
        media_format: "svg",
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
  const tmp = `${DB_PATH}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
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
    parsed.billing_events ??= [];
    for (const video of parsed.videos ?? []) {
      video.scenes ??= null;
      video.media_format ??= "svg";
    }
    for (const credit of parsed.credits ?? []) {
      credit.stripe_customer_id ??= null;
      credit.stripe_subscription_id ??= null;
      credit.subscription_status ??= stripeLedger ? null : "active";
      credit.price_id ??= null;
      credit.current_period_end ??= null;
      credit.cancel_at_period_end ??= false;
      credit.subscription_paused ??= false;
      if (stripeLedger && (!credit.plan || credit.plan === "local-unlimited")) {
        // Flipping GOLPO_BILLING_MODE to stripe must not leave a store created
        // in mock mode with infinite credits.
        credit.plan = "free";
        credit.credits = 0;
        credit.next_subscription_date = null;
        credit.watermark_add_on = false;
        credit.lang_add_on = false;
        credit.script_add_on = false;
        credit.video_instruction_add_on = false;
        credit.logo_add_on = false;
        credit.team_add_on = false;
        credit.api_add_on = false;
        credit.longer_videos_add_on = false;
      }
    }
    for (const user of parsed.users ?? []) {
      user.external_id ??= null;
    }
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
  const run = dbState.queue.then(async () => {
    const db = await ensure();
    const result = await fn(db);
    db.updated_at = nowIso();
    await persist(db);
    return result;
  });
  dbState.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export { creditsFor, nowIso };
