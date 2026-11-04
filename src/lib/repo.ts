import "server-only";

import { createHash } from "node:crypto";

import { readDb, withDb, creditsFor, nowIso, DEMO_USER_ID } from "@/lib/db";
import { uuid, jobId as newJobId, videoId as newVideoId } from "@/lib/ids";
import type {
  ApiKey,
  Character,
  Changelog,
  CreditAccount,
  CustomMusic,
  Job,
  Organization,
  Playlist,
  SavedStyle,
  Upload,
  User,
  Video,
  VoiceClone,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

function slugName(email: string): string {
  const local = email.split("@")[0] ?? "creator";
  return local.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function getUserById(id: string): Promise<User | undefined> {
  const db = await readDb();
  return db.users.find((user) => user.id === id);
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const db = await readDb();
  const normalized = email.trim().toLowerCase();
  return db.users.find((user) => user.email.toLowerCase() === normalized);
}

/** Upserts the user on sign-in, the way GoTrue would after an OAuth callback. */
export async function upsertUser(input: {
  email: string;
  name?: string;
  provider: User["provider"];
  avatarUrl?: string | null;
}): Promise<User> {
  const email = input.email.trim().toLowerCase();
  return withDb((db) => {
    const existing = db.users.find((user) => user.email.toLowerCase() === email);
    const timestamp = nowIso();
    if (existing) {
      existing.last_login_at = timestamp;
      existing.provider = input.provider;
      if (input.name) existing.name = input.name;
      if (input.avatarUrl !== undefined) existing.avatar_url = input.avatarUrl;
      if (!db.credits.some((c) => c.user_id === existing.id)) {
        db.credits.push(creditsFor(existing));
      }
      return existing;
    }
    const user: User = {
      id: uuid(),
      email,
      name: input.name?.trim() || slugName(email),
      display_name: input.name?.trim() || slugName(email),
      provider: input.provider,
      avatar_url: input.avatarUrl ?? null,
      created_at: timestamp,
      last_login_at: timestamp,
    };
    db.users.push(user);
    db.credits.push(creditsFor(user));
    return user;
  });
}

export async function ensureDemoUser(): Promise<User> {
  const existing = await getUserById(DEMO_USER_ID);
  if (existing) return existing;
  return upsertUser({
    email: "demo@golpo.local",
    name: "Local Dev",
    provider: "dev",
  });
}

// ---------------------------------------------------------------------------
// Credits (mock ledger)
// ---------------------------------------------------------------------------

export async function getCreditAccount(userId: string): Promise<CreditAccount | undefined> {
  const db = await readDb();
  return db.credits.find((row) => row.user_id === userId);
}

export async function setCustomLogo(userId: string, url: string): Promise<void> {
  await withDb((db) => {
    const row = db.credits.find((credit) => credit.user_id === userId);
    if (row) row.custom_logo_url = url;
  });
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

export interface VideoFilters {
  search?: string;
  type?: "all" | "video" | "podcast";
  style?: string;
  language?: string;
  visibility?: "all" | "private" | "public" | "unlisted";
  limit?: number;
  offset?: number;
}

export async function listVideos(userId: string, filters: VideoFilters = {}): Promise<Video[]> {
  const db = await readDb();
  const search = filters.search?.trim().toLowerCase();
  let rows = db.videos.filter((video) => video.user_id === userId);
  if (filters.type && filters.type !== "all") {
    rows = rows.filter((video) => video.kind === filters.type);
  }
  if (filters.style) rows = rows.filter((video) => video.style === filters.style);
  if (filters.language) rows = rows.filter((video) => video.language === filters.language);
  if (filters.visibility && filters.visibility !== "all") {
    rows = rows.filter((video) => video.visibility === filters.visibility);
  }
  if (search) {
    rows = rows.filter(
      (video) =>
        video.title.toLowerCase().includes(search) ||
        (video.script ?? "").toLowerCase().includes(search),
    );
  }
  rows = rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const offset = filters.offset ?? 0;
  return rows.slice(offset, filters.limit ? offset + filters.limit : undefined);
}

export async function getVideo(id: string, userId?: string): Promise<Video | undefined> {
  const db = await readDb();
  const video = db.videos.find((row) => row.id === id);
  if (!video) return undefined;
  if (userId && video.user_id !== userId) return undefined;
  return video;
}

export async function createVideoRecord(
  input: Omit<Video, "created_at" | "updated_at">,
): Promise<Video> {
  return withDb((db) => {
    const timestamp = nowIso();
    const video: Video = { ...input, created_at: timestamp, updated_at: timestamp };
    db.videos.unshift(video);
    return video;
  });
}

export async function updateVideo(
  id: string,
  patch: Partial<Omit<Video, "id" | "user_id" | "created_at">>,
): Promise<Video | undefined> {
  return withDb((db) => {
    const video = db.videos.find((row) => row.id === id);
    if (!video) return undefined;
    Object.assign(video, patch, { updated_at: nowIso() });
    return video;
  });
}

export async function deleteVideo(id: string, userId: string): Promise<boolean> {
  return withDb((db) => {
    const index = db.videos.findIndex((row) => row.id === id && row.user_id === userId);
    if (index === -1) return false;
    db.videos.splice(index, 1);
    db.playlists.forEach((playlist) => {
      playlist.video_ids = playlist.video_ids.filter((videoId) => videoId !== id);
    });
    return true;
  });
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function createJobRecord(
  input: Omit<Job, "id" | "created_at" | "updated_at">,
): Promise<Job> {
  return withDb((db) => {
    const timestamp = nowIso();
    const job: Job = { ...input, id: newJobId(), created_at: timestamp, updated_at: timestamp };
    db.jobs.unshift(job);
    return job;
  });
}

export async function getJob(id: string, userId?: string): Promise<Job | undefined> {
  const db = await readDb();
  const job = db.jobs.find((row) => row.id === id);
  if (!job) return undefined;
  if (userId && job.user_id !== userId) return undefined;
  return job;
}

export async function updateJob(id: string, patch: Partial<Job>): Promise<Job | undefined> {
  return withDb((db) => {
    const job = db.jobs.find((row) => row.id === id);
    if (!job) return undefined;
    Object.assign(job, patch, { updated_at: nowIso() });
    return job;
  });
}

export async function countActiveJobs(userId: string): Promise<number> {
  const db = await readDb();
  return db.jobs.filter(
    (job) => job.user_id === userId && (job.status === "queued" || job.status === "processing"),
  ).length;
}

export async function listJobs(userId: string, limit = 20): Promise<Job[]> {
  const db = await readDb();
  return db.jobs
    .filter((job) => job.user_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

export { newVideoId };

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export async function listCharacters(userId: string): Promise<Character[]> {
  const db = await readDb();
  return db.characters.filter((row) => row.user_id === userId);
}

export async function createCharacter(
  userId: string,
  input: { name: string; description: string; image_url?: string | null },
): Promise<Character> {
  return withDb((db) => {
    const character: Character = {
      id: uuid(),
      user_id: userId,
      name: input.name,
      description: input.description,
      image_url: input.image_url ?? null,
      created_at: nowIso(),
    };
    db.characters.unshift(character);
    return character;
  });
}

export async function updateCharacter(
  userId: string,
  id: string,
  patch: Partial<Pick<Character, "name" | "description" | "image_url">>,
): Promise<Character | undefined> {
  return withDb((db) => {
    const row = db.characters.find((c) => c.id === id && c.user_id === userId);
    if (!row) return undefined;
    Object.assign(row, patch);
    return row;
  });
}

export async function deleteCharacter(userId: string, id: string): Promise<boolean> {
  return withDb((db) => {
    const index = db.characters.findIndex((c) => c.id === id && c.user_id === userId);
    if (index === -1) return false;
    db.characters.splice(index, 1);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Saved styles / custom canvas styles
// ---------------------------------------------------------------------------

export async function listStyles(userId: string): Promise<SavedStyle[]> {
  const db = await readDb();
  return db.styles.filter((row) => row.user_id === userId);
}

export async function createStyle(
  userId: string,
  input: { name: string; prompt: string; image_style?: string | null },
): Promise<SavedStyle> {
  return withDb((db) => {
    const style: SavedStyle = {
      id: uuid(),
      user_id: userId,
      name: input.name,
      prompt: input.prompt,
      image_style: input.image_style ?? null,
      preview_url: null,
      created_at: nowIso(),
    };
    db.styles.unshift(style);
    return style;
  });
}

export async function deleteStyle(userId: string, id: string): Promise<boolean> {
  return withDb((db) => {
    const index = db.styles.findIndex((s) => s.id === id && s.user_id === userId);
    if (index === -1) return false;
    db.styles.splice(index, 1);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Voice clones
// ---------------------------------------------------------------------------

export async function listVoiceClones(userId: string): Promise<VoiceClone[]> {
  const db = await readDb();
  return db.voice_clones.filter((row) => row.user_id === userId);
}

export async function createVoiceClone(
  userId: string,
  input: { name: string; language?: string; sample_count?: number },
): Promise<VoiceClone> {
  return withDb((db) => {
    const clone: VoiceClone = {
      id: uuid(),
      user_id: userId,
      name: input.name,
      status: "ready",
      language: input.language ?? "en",
      sample_count: input.sample_count ?? 1,
      created_at: nowIso(),
    };
    db.voice_clones.unshift(clone);
    return clone;
  });
}

export async function deleteVoiceClone(userId: string, id: string): Promise<boolean> {
  return withDb((db) => {
    const index = db.voice_clones.findIndex((v) => v.id === id && v.user_id === userId);
    if (index === -1) return false;
    db.voice_clones.splice(index, 1);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Custom music
// ---------------------------------------------------------------------------

export async function listCustomMusic(userId: string): Promise<CustomMusic[]> {
  const db = await readDb();
  return db.custom_music.filter((row) => row.user_id === userId);
}

export async function createCustomMusic(
  userId: string,
  input: { name: string; url: string; duration_seconds?: number },
): Promise<CustomMusic> {
  return withDb((db) => {
    const track: CustomMusic = {
      id: uuid(),
      user_id: userId,
      name: input.name,
      url: input.url,
      duration_seconds: input.duration_seconds ?? 0,
      created_at: nowIso(),
    };
    db.custom_music.unshift(track);
    return track;
  });
}

export async function deleteCustomMusic(userId: string, id: string): Promise<boolean> {
  return withDb((db) => {
    const index = db.custom_music.findIndex((m) => m.id === id && m.user_id === userId);
    if (index === -1) return false;
    db.custom_music.splice(index, 1);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Playlists
// ---------------------------------------------------------------------------

export async function listPlaylists(userId: string): Promise<Playlist[]> {
  const db = await readDb();
  return db.playlists.filter((row) => row.user_id === userId);
}

export async function createPlaylist(
  userId: string,
  input: { name: string; description?: string; video_ids?: string[] },
): Promise<Playlist> {
  return withDb((db) => {
    const timestamp = nowIso();
    const playlist: Playlist = {
      id: uuid(),
      user_id: userId,
      name: input.name,
      description: input.description ?? "",
      video_ids: input.video_ids ?? [],
      created_at: timestamp,
      updated_at: timestamp,
    };
    db.playlists.unshift(playlist);
    return playlist;
  });
}

export async function updatePlaylist(
  userId: string,
  id: string,
  patch: Partial<Pick<Playlist, "name" | "description" | "video_ids">>,
): Promise<Playlist | undefined> {
  return withDb((db) => {
    const row = db.playlists.find((p) => p.id === id && p.user_id === userId);
    if (!row) return undefined;
    Object.assign(row, patch, { updated_at: nowIso() });
    return row;
  });
}

export async function deletePlaylist(userId: string, id: string): Promise<boolean> {
  return withDb((db) => {
    const index = db.playlists.findIndex((p) => p.id === id && p.user_id === userId);
    if (index === -1) return false;
    db.playlists.splice(index, 1);
    return true;
  });
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function listApiKeys(userId: string): Promise<ApiKey[]> {
  const db = await readDb();
  return db.api_keys.filter((row) => row.user_id === userId);
}

export async function createApiKey(
  userId: string,
  name: string,
): Promise<{ record: ApiKey; plaintext: string }> {
  // Reported format in the API-key panel is not observable; `glp_live_` is a
  // local convention so keys are visually distinguishable from Stripe keys.
  const plaintext = `glp_live_${createHash("sha256")
    .update(`${userId}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 40)}`;
  const record = await withDb((db) => {
    const key: ApiKey = {
      id: uuid(),
      user_id: userId,
      name: name || "Untitled key",
      prefix: plaintext.slice(0, 12),
      key_hash: hashApiKey(plaintext),
      created_at: nowIso(),
      last_used_at: null,
      revoked_at: null,
    };
    db.api_keys.unshift(key);
    return key;
  });
  return { record, plaintext };
}

export async function findApiKeyByPlaintext(key: string): Promise<ApiKey | undefined> {
  const db = await readDb();
  const hash = hashApiKey(key);
  return db.api_keys.find((row) => row.key_hash === hash && !row.revoked_at);
}

export async function touchApiKey(id: string): Promise<void> {
  await withDb((db) => {
    const key = db.api_keys.find((row) => row.id === id);
    if (key) key.last_used_at = nowIso();
  });
}

export async function revokeApiKey(userId: string, id: string): Promise<boolean> {
  return withDb((db) => {
    const key = db.api_keys.find((row) => row.id === id && row.user_id === userId);
    if (!key) return false;
    key.revoked_at = nowIso();
    return true;
  });
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export async function listOrganizations(userId: string): Promise<Organization[]> {
  const db = await readDb();
  return db.organizations.filter(
    (row) => row.owner_id === userId || row.member_ids.includes(userId),
  );
}

export async function createOrganization(
  userId: string,
  name: string,
  seatCount = 3,
): Promise<Organization> {
  return withDb((db) => {
    const org: Organization = {
      id: uuid(),
      name,
      owner_id: userId,
      seat_count: seatCount,
      member_ids: [userId],
      created_at: nowIso(),
    };
    db.organizations.unshift(org);
    return org;
  });
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

export async function createUploadRecord(input: Upload): Promise<Upload> {
  return withDb((db) => {
    db.uploads.unshift(input);
    return input;
  });
}

export async function getUpload(id: string): Promise<Upload | undefined> {
  const db = await readDb();
  return db.uploads.find((row) => row.id === id);
}

// ---------------------------------------------------------------------------
// Changelogs / status / admin
// ---------------------------------------------------------------------------

export async function listChangelogs(page = 1, pageSize = 3): Promise<Changelog[]> {
  const db = await readDb();
  const start = Math.max(page - 1, 0) * pageSize;
  return db.changelogs
    .slice()
    .sort((a, b) => b.released_at.localeCompare(a.released_at))
    .slice(start, start + pageSize);
}

export async function getSystemStatus() {
  const db = await readDb();
  return db.system_status;
}

export async function getAdminRole(userId: string) {
  const db = await readDb();
  return db.admin_roles.find((row) => row.user_id === userId);
}

export async function listVideoIdsPublic(userId: string): Promise<string[]> {
  const db = await readDb();
  return db.videos.filter((v) => v.user_id === userId).map((v) => v.id);
}
