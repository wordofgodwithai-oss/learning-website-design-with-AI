import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import type { Database, CreditAccount, User } from "@/lib/types";
import { MOCK_INFINITE_CREDITS } from "@/lib/billing/constants";
import { billingMode, unlimitedDevOverride } from "@/lib/integrations";
import { pool, transaction, DB_LABEL, DB_NAME } from "@/lib/mysql";
import type { RowDataPacket } from "mysql2/promise";

/**
 * MySQL-backed store (WAMP).
 *
 * Every row lives in a real table (`db/schema.sql`); nested values use JSON
 * columns. The app still reads and mutates one in-memory `Database` snapshot
 * inside `withDb`, which keeps the generation pipeline's read-modify-write
 * blocks atomic and easy to reason about. Each `withDb` call diffs the snapshot
 * and writes only the rows that changed, in one transaction:
 *
 *   read snapshot → mutate → diff → UPSERT/DELETE changed rows → commit
 *
 * `readDb` is a read-only view of the same snapshot. Documents written by the
 * old JSON store are imported automatically the first time the database is
 * empty, so upgrading keeps every user, video and job.
 *
 * Auth-only columns (`users.password_hash`) and sessions are deliberately not
 * part of the snapshot: they are read and written with dedicated helpers in
 * `src/lib/repo.ts` so a password hash can never leak into an API response.
 */

const DATA_DIR = process.env.GOLPO_DATA_DIR
  ? path.resolve(process.env.GOLPO_DATA_DIR)
  : path.join(process.cwd(), ".data");

const LEGACY_DB_PATH = path.join(DATA_DIR, "db.json");

export const DEMO_USER_ID = "usr_local_demo";
export const DEMO_EMAIL = process.env.GOLPO_DEMO_EMAIL ?? "demo@golpo.local";
export const DEMO_API_KEY =
  process.env.GOLPO_DEV_API_KEY ?? "glp_local_dev_key_change_me";

// ---------------------------------------------------------------------------
// Table specs — column order, JSON columns, timestamp columns, booleans.
// ---------------------------------------------------------------------------

interface TableSpec {
  table: string;
  collection: Exclude<keyof Database, "version" | "updated_at" | "system_status">;
  key: string;
  columns: string[];
  json: string[];
  dates: string[];
  bools: string[];
}

const SPECS: TableSpec[] = [
  {
    table: "users",
    collection: "users",
    key: "id",
    columns: [
      "id",
      "email",
      "name",
      "display_name",
      "provider",
      "external_id",
      "avatar_url",
      "created_at",
      "last_login_at",
    ],
    json: [],
    dates: ["created_at", "last_login_at"],
    bools: [],
  },
  {
    table: "credits",
    collection: "credits",
    key: "user_id",
    columns: [
      "user_id",
      "credits",
      "plan",
      "email",
      "name",
      "stripe_email",
      "next_subscription_date",
      "custom_logo_url",
      "subscription_canceled",
      "stripe_customer_id",
      "stripe_subscription_id",
      "subscription_status",
      "price_id",
      "current_period_end",
      "cancel_at_period_end",
      "subscription_paused",
      "created_at",
      "generation_preferences",
      "experiment_assignment",
      "watermark_add_on",
      "lang_add_on",
      "script_add_on",
      "video_instruction_add_on",
      "logo_add_on",
      "team_add_on",
      "api_add_on",
      "longer_videos_add_on",
    ],
    json: ["generation_preferences"],
    dates: ["next_subscription_date", "current_period_end", "created_at"],
    bools: [
      "subscription_canceled",
      "cancel_at_period_end",
      "subscription_paused",
      "watermark_add_on",
      "lang_add_on",
      "script_add_on",
      "video_instruction_add_on",
      "logo_add_on",
      "team_add_on",
      "api_add_on",
      "longer_videos_add_on",
    ],
  },
  {
    table: "videos",
    collection: "videos",
    key: "id",
    columns: [
      "id",
      "user_id",
      "job_id",
      "title",
      "status",
      "kind",
      "engine",
      "style",
      "image_style",
      "pen_style",
      "language",
      "display_language",
      "duration_seconds",
      "visibility",
      "script",
      "scenes",
      "video_url",
      "poster_url",
      "media_format",
      "watermark",
      "is_audio_only",
      "render",
      "variant_of",
      "variant_language",
      "error",
      "created_at",
      "updated_at",
    ],
    json: ["scenes", "render"],
    dates: ["created_at", "updated_at"],
    bools: ["watermark", "is_audio_only"],
  },
  {
    table: "jobs",
    collection: "jobs",
    key: "id",
    columns: [
      "id",
      "user_id",
      "video_id",
      "status",
      "stage",
      "progress",
      "kind",
      "script",
      "error",
      "request",
      "variant_video_ids",
      "is_script_generation",
      "is_audio_only",
      "created_at",
      "updated_at",
      "completes_at",
      "render_started_at",
      "render_token",
    ],
    json: ["request", "variant_video_ids"],
    dates: ["created_at", "updated_at"],
    bools: ["is_script_generation", "is_audio_only"],
  },
  {
    table: "characters",
    collection: "characters",
    key: "id",
    columns: ["id", "user_id", "name", "description", "image_url", "created_at"],
    json: [],
    dates: ["created_at"],
    bools: [],
  },
  {
    table: "styles",
    collection: "styles",
    key: "id",
    columns: ["id", "user_id", "name", "prompt", "image_style", "preview_url", "created_at"],
    json: [],
    dates: ["created_at"],
    bools: [],
  },
  {
    table: "voice_clones",
    collection: "voice_clones",
    key: "id",
    columns: ["id", "user_id", "name", "status", "language", "sample_count", "created_at"],
    json: [],
    dates: ["created_at"],
    bools: [],
  },
  {
    table: "custom_music",
    collection: "custom_music",
    key: "id",
    columns: ["id", "user_id", "name", "url", "duration_seconds", "created_at"],
    json: [],
    dates: ["created_at"],
    bools: [],
  },
  {
    table: "playlists",
    collection: "playlists",
    key: "id",
    columns: ["id", "user_id", "name", "description", "video_ids", "created_at", "updated_at"],
    json: ["video_ids"],
    dates: ["created_at", "updated_at"],
    bools: [],
  },
  {
    table: "api_keys",
    collection: "api_keys",
    key: "id",
    columns: [
      "id",
      "user_id",
      "name",
      "prefix",
      "key_hash",
      "created_at",
      "last_used_at",
      "revoked_at",
    ],
    json: [],
    dates: ["created_at", "last_used_at", "revoked_at"],
    bools: [],
  },
  {
    table: "organizations",
    collection: "organizations",
    key: "id",
    columns: ["id", "name", "owner_id", "seat_count", "member_ids", "created_at"],
    json: ["member_ids"],
    dates: ["created_at"],
    bools: [],
  },
  {
    table: "uploads",
    collection: "uploads",
    key: "id",
    columns: [
      "id",
      "user_id",
      "filename",
      "content_type",
      "size",
      "storage_path",
      "url",
      "created_at",
    ],
    json: [],
    dates: ["created_at"],
    bools: [],
  },
  {
    table: "changelogs",
    collection: "changelogs",
    key: "id",
    columns: ["id", "version", "title", "summary", "body", "released_at"],
    json: ["body"],
    dates: ["released_at"],
    bools: [],
  },
  {
    table: "admin_roles",
    collection: "admin_roles",
    key: "user_id",
    columns: ["user_id", "role", "permissions"],
    json: ["permissions"],
    dates: [],
    bools: [],
  },
  {
    table: "billing_events",
    collection: "billing_events",
    key: "id",
    columns: ["id", "type", "user_id", "received_at"],
    json: [],
    dates: ["received_at"],
    bools: [],
  },
];

type LooseEntity = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Row <-> entity conversion
// ---------------------------------------------------------------------------

function toDbValue(spec: TableSpec, column: string, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (spec.json.includes(column)) return JSON.stringify(value);
  if (spec.dates.includes(column)) {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }
  if (spec.bools.includes(column)) return value ? 1 : 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function fromDbValue(spec: TableSpec, column: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (spec.json.includes(column)) {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    return value;
  }
  if (spec.dates.includes(column)) {
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (spec.bools.includes(column)) return Boolean(Number(value));
  return value;
}

function rowToEntity(spec: TableSpec, row: RowDataPacket): LooseEntity {
  const entity: LooseEntity = {};
  for (const column of spec.columns) {
    entity[column] = fromDbValue(spec, column, row[column]);
  }
  return entity;
}

function entityToValues(spec: TableSpec, entity: LooseEntity): unknown[] {
  return spec.columns.map((column) => toDbValue(spec, column, entity[column]));
}

function upsertSql(spec: TableSpec): string {
  const columns = spec.columns.map((column) => `\`${column}\``).join(", ");
  const updates = spec.columns
    .filter((column) => column !== spec.key)
    .map((column) => `\`${column}\`=VALUES(\`${column}\`)`)
    .join(", ");
  return `INSERT INTO \`${spec.table}\` (${columns}) VALUES (?) ON DUPLICATE KEY UPDATE ${updates}`;
}

/** Stable serialisation so `{a,b}` and `{b,a}` compare equal when diffing. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item) && !(item instanceof Date)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(item as Record<string, unknown>).sort()) {
        sorted[key] = (item as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return item;
  });
}

// ---------------------------------------------------------------------------
// Seed / migration
// ---------------------------------------------------------------------------

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
    email: DEMO_EMAIL,
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
            "Email and password sign-in stored in MySQL",
            "Canvas, Studio and Sketch engines, each with its own style catalogue",
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

/** Restores the defaults older builds relied on, then narrows required dates. */
function normalise(db: Database): Database {
  const created = nowIso();
  db.version ??= 1;
  db.users ??= [];
  db.credits ??= [];
  db.videos ??= [];
  db.jobs ??= [];
  db.characters ??= [];
  db.styles ??= [];
  db.voice_clones ??= [];
  db.custom_music ??= [];
  db.playlists ??= [];
  db.api_keys ??= [];
  db.organizations ??= [];
  db.uploads ??= [];
  db.changelogs ??= [];
  db.admin_roles ??= [];
  db.billing_events ??= [];
  db.updated_at ??= created;

  for (const user of db.users) {
    user.external_id ??= null;
    user.avatar_url ??= null;
    user.created_at ||= created;
    user.last_login_at ||= user.created_at;
    user.provider ||= "dev";
    user.name ||= user.email;
    user.display_name ||= user.name;
  }
  for (const credit of db.credits) {
    credit.subscription_canceled ??= false;
    credit.stripe_customer_id ??= null;
    credit.stripe_subscription_id ??= null;
    credit.subscription_status ??= stripeLedger ? null : "active";
    credit.price_id ??= null;
    credit.current_period_end ??= null;
    credit.cancel_at_period_end ??= false;
    credit.subscription_paused ??= false;
    credit.stripe_email ??= null;
    credit.custom_logo_url ??= null;
    credit.generation_preferences ??= null;
    credit.experiment_assignment ??= stripeLedger ? "stripe" : "local_dev";
    credit.created_at ||= created;
    if (stripeLedger && (!credit.plan || credit.plan === "local-unlimited")) {
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
  for (const video of db.videos) {
    video.scenes ??= null;
    video.render ??= null;
    video.media_format ??= "svg";
    video.job_id ??= null;
    video.image_style ??= null;
    video.pen_style ??= null;
    video.variant_of ??= null;
    video.variant_language ??= null;
    video.error ??= null;
    video.script ??= null;
    video.video_url ??= null;
    video.poster_url ??= null;
    video.title ||= "Untitled video";
    video.status ||= "ready";
    video.kind ||= "video";
    video.engine ||= "golpo_canvas";
    video.style ||= "whiteboard";
    video.language ||= "en";
    video.display_language ||= "English";
    video.visibility ||= "private";
    video.duration_seconds ||= 60;
    video.watermark ??= false;
    video.is_audio_only ??= false;
    video.created_at ||= created;
    video.updated_at ||= video.created_at;
  }
  for (const job of db.jobs) {
    job.request ??= {};
    job.variant_video_ids ??= [];
    job.script ??= null;
    job.error ??= null;
    job.video_id ??= null;
    job.is_script_generation ??= false;
    job.is_audio_only ??= false;
    job.status ||= "queued";
    job.stage ||= "queued";
    job.kind ||= "video";
    job.progress ??= 0;
    job.completes_at ??= Date.now();
    job.render_started_at ??= null;
    job.render_token ??= null;
    job.created_at ||= created;
    job.updated_at ||= job.created_at;
  }
  for (const character of db.characters) {
    character.image_url ??= null;
    character.created_at ||= created;
  }
  for (const style of db.styles) {
    style.image_style ??= null;
    style.preview_url ??= null;
    style.created_at ||= created;
  }
  for (const clone of db.voice_clones) {
    clone.status ||= "ready";
    clone.language ||= "en";
    clone.sample_count ??= 1;
    clone.created_at ||= created;
  }
  for (const track of db.custom_music) {
    track.duration_seconds ??= 0;
    track.created_at ||= created;
  }
  for (const playlist of db.playlists) {
    playlist.video_ids ??= [];
    playlist.description ??= "";
    playlist.created_at ||= created;
    playlist.updated_at ||= playlist.created_at;
  }
  for (const key of db.api_keys) {
    key.last_used_at ??= null;
    key.revoked_at ??= null;
    key.created_at ||= created;
  }
  for (const org of db.organizations) {
    org.member_ids ??= [];
    org.seat_count ??= 1;
    org.created_at ||= created;
  }
  for (const upload of db.uploads) {
    upload.size ??= 0;
    upload.content_type ||= "application/octet-stream";
    upload.created_at ||= created;
  }
  for (const changelog of db.changelogs) {
    changelog.body ??= { feature: [] };
    changelog.summary ||= "";
    changelog.version ||= "1.0.0";
    changelog.title ||= "Untitled";
    changelog.released_at ||= created;
  }
  for (const event of db.billing_events) {
    event.received_at ||= created;
    event.user_id ??= null;
  }
  if (!db.system_status) {
    db.system_status = {
      force_show: false,
      force_hide: false,
      auto_detect_enabled: true,
      title: "Local development mode",
      message: "Billing and feature gating are mocked. Credits are infinite.",
      severity: "info",
    };
  }
  return db;
}

async function readLegacy(): Promise<Database | null> {
  try {
    const raw = await fs.readFile(LEGACY_DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as Database;
    if (!parsed || !Array.isArray(parsed.users) || parsed.users.length === 0) return null;
    return normalise(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.warn(`[db] could not read legacy ${LEGACY_DB_PATH}: ${(error as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

function emptyDatabase(): Database {
  return {
    version: 1,
    users: [],
    credits: [],
    videos: [],
    jobs: [],
    characters: [],
    styles: [],
    voice_clones: [],
    custom_music: [],
    playlists: [],
    api_keys: [],
    organizations: [],
    uploads: [],
    changelogs: [],
    system_status: {
      force_show: false,
      force_hide: false,
      auto_detect_enabled: true,
      title: "",
      message: "",
      severity: "info",
    },
    admin_roles: [],
    billing_events: [],
    updated_at: nowIso(),
  };
}

async function loadFromMysql(): Promise<Database | null> {
  const [userRows] = await pool.query<RowDataPacket[]>("SELECT * FROM users LIMIT 1");
  if (userRows.length === 0) return null;

  const db = emptyDatabase();
  for (const spec of SPECS) {
    const [tableRows] = await pool.query<RowDataPacket[]>(`SELECT * FROM \`${spec.table}\``);
    const entities = tableRows.map((row) => rowToEntity(spec, row));
    (db[spec.collection] as unknown as LooseEntity[]) = entities;
  }

  const [statusRows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM system_status WHERE id = 1",
  );
  if (statusRows.length > 0) {
    const row = statusRows[0];
    db.system_status = {
      force_show: Boolean(Number(row.force_show)),
      force_hide: Boolean(Number(row.force_hide)),
      auto_detect_enabled: Boolean(Number(row.auto_detect_enabled)),
      title: String(row.title ?? ""),
      message: String(row.message ?? ""),
      severity: (String(row.severity ?? "info") as Database["system_status"]["severity"]) ?? "info",
    };
  }

  const [metaRows] = await pool.query<RowDataPacket[]>("SELECT * FROM app_meta");
  for (const row of metaRows) {
    if (row.k === "version") db.version = Number(row.v) || 1;
    if (row.k === "updated_at") db.updated_at = String(row.v);
  }

  return normalise(db);
}

async function writeAll(db: Database): Promise<void> {
  await transaction(async (connection) => {
    for (const spec of SPECS) {
      const entities = db[spec.collection] as unknown as LooseEntity[];
      const sql = upsertSql(spec);
      for (const entity of entities) {
        await connection.query(sql, [entityToValues(spec, entity)]);
      }
    }

    const status = db.system_status;
    await connection.query(
      `INSERT INTO system_status (id, force_show, force_hide, auto_detect_enabled, title, message, severity)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE force_show=VALUES(force_show), force_hide=VALUES(force_hide),
         auto_detect_enabled=VALUES(auto_detect_enabled), title=VALUES(title),
         message=VALUES(message), severity=VALUES(severity)`,
      [
        status.force_show ? 1 : 0,
        status.force_hide ? 1 : 0,
        status.auto_detect_enabled ? 1 : 0,
        status.title,
        status.message,
        status.severity,
      ],
    );

    await connection.query(
      `INSERT INTO app_meta (k, v) VALUES ('version', ?), ('updated_at', ?)
       ON DUPLICATE KEY UPDATE v=VALUES(v)`,
      [String(db.version), db.updated_at],
    );
  });
}

async function ensureDatabase(): Promise<Database> {
  let existing: Database | null;
  try {
    existing = await loadFromMysql();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ER_BAD_DB_ERROR") {
      throw new Error(
        `MySQL database "${DB_NAME}" does not exist. Run \`npm run db:setup\` (target: ${DB_LABEL}).`,
      );
    }
    if (code === "ECONNREFUSED" || code === "ETIMEDOUT") {
      throw new Error(
        `Cannot reach MySQL at ${DB_LABEL}. Start WAMP and check GOLPO_DB_* in .env.local.`,
      );
    }
    throw error;
  }
  if (existing) {
    console.log(
      `[db] mysql ready — ${existing.users.length} users, ${existing.videos.length} videos, ${existing.jobs.length} jobs`,
    );
    return existing;
  }

  const legacy = await readLegacy();
  const fresh = legacy ?? seed();
  await writeAll(fresh);
  console.log(
    legacy
      ? `[db] imported ${fresh.videos.length} videos and ${fresh.jobs.length} jobs from ${LEGACY_DB_PATH} into MySQL`
      : "[db] mysql schema was empty — seeded the demo account",
  );
  return fresh;
}

// ---------------------------------------------------------------------------
// Public store API
// ---------------------------------------------------------------------------

type Store = { db: Database | null; loading: Promise<Database> | null };

/**
 * Next.js hot-reloads route modules in dev, which re-evaluates this module. Keep
 * the snapshot and the write queue on globalThis so every instance shares them
 * and two requests can never interleave a read-modify-write.
 */
const globalStore = globalThis as unknown as {
  __golpoStore?: { store: Store; queue: Promise<unknown> };
};
const dbState = (globalStore.__golpoStore ??= {
  store: { db: null, loading: null },
  queue: Promise.resolve(),
});
const store: Store = dbState.store;

async function ensure(): Promise<Database> {
  if (store.db) return store.db;
  if (!store.loading) {
    store.loading = ensureDatabase()
      .then((db) => {
        store.db = db;
        return db;
      })
      .finally(() => {
        store.loading = null;
      });
  }
  return store.loading;
}

/** Read-only snapshot. Callers must not mutate the returned object. */
export async function readDb(): Promise<Database> {
  return ensure();
}

/**
 * Read-modify-write inside a process-wide mutex. The snapshot is cloned first,
 * then the diff is written in one MySQL transaction. A failed write discards
 * the in-memory snapshot so the next read reloads the committed state.
 */
export async function withDb<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
  const run = dbState.queue.then(async () => {
    const db = await ensure();
    const before = structuredClone(db);

    const result = await fn(db);
    db.updated_at = nowIso();

    try {
      await writeDiff(before, db);
    } catch (error) {
      store.db = null;
      throw error;
    }
    return result;
  });

  dbState.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function writeDiff(before: Database, after: Database): Promise<void> {
  await transaction(async (connection) => {
    for (const spec of SPECS) {
      const nextEntities = after[spec.collection] as unknown as LooseEntity[];
      const previous = new Map<string, LooseEntity>();
      for (const entity of before[spec.collection] as unknown as LooseEntity[]) {
        previous.set(String(entity[spec.key]), entity);
      }

      const sql = upsertSql(spec);
      for (const entity of nextEntities) {
        const id = String(entity[spec.key]);
        const old = previous.get(id);
        if (!old || stable(old) !== stable(entity)) {
          await connection.query(sql, [entityToValues(spec, entity)]);
        }
        previous.delete(id);
      }

      for (const id of previous.keys()) {
        await connection.query(
          `DELETE FROM \`${spec.table}\` WHERE \`${spec.key}\` = ?`,
          [id],
        );
      }
    }

    const beforeStatus = stable(before.system_status);
    if (beforeStatus !== stable(after.system_status)) {
      const status = after.system_status;
      await connection.query(
        `INSERT INTO system_status (id, force_show, force_hide, auto_detect_enabled, title, message, severity)
         VALUES (1, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE force_show=VALUES(force_show), force_hide=VALUES(force_hide),
           auto_detect_enabled=VALUES(auto_detect_enabled), title=VALUES(title),
           message=VALUES(message), severity=VALUES(severity)`,
        [
          status.force_show ? 1 : 0,
          status.force_hide ? 1 : 0,
          status.auto_detect_enabled ? 1 : 0,
          status.title,
          status.message,
          status.severity,
        ],
      );
    }

    await connection.query(
      `INSERT INTO app_meta (k, v) VALUES ('version', ?), ('updated_at', ?)
       ON DUPLICATE KEY UPDATE v=VALUES(v)`,
      [String(after.version), after.updated_at],
    );
  });
}

export { creditsFor, nowIso };
