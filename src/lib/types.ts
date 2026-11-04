// ---------------------------------------------------------------------------
// Data model for the local Golpo clone.
//
// Column names follow the observations in REPORT.md section 9 (Supabase
// `user_credits`, `user_credits`, `api_key`, `organizations`, `system_status`)
// and section 5 (the shapes returned by the dashboard BFF). Anything not
// observable from the shipped client is marked as a design choice.
// ---------------------------------------------------------------------------

export type VideoStatus = "queued" | "processing" | "ready" | "failed";
export type JobStatus = "queued" | "processing" | "script_ready" | "ready" | "failed";
export type Visibility = "private" | "public" | "unlisted";
export type Engine = "golpo_canvas" | "golpo_sketch";
export type GenerationKind = "video" | "podcast";

export interface User {
  id: string;
  email: string;
  name: string;
  display_name: string;
  provider: "google" | "microsoft" | "dev";
  /** Supabase `auth.users.id` when auth runs in live mode. */
  external_id?: string | null;
  avatar_url: string | null;
  created_at: string;
  last_login_at: string;
}

/**
 * Mirrors the `user_credits` row the real dashboard reads from PostgREST.
 * In the default mock mode credits are MOCK_INFINITE_CREDITS and every add-on
 * flag is true; in Stripe mode the same row is the real ledger. See
 * src/lib/billing/.
 */
export interface CreditAccount {
  user_id: string;
  credits: number;
  plan: string;
  email: string;
  name: string;
  stripe_email: string | null;
  next_subscription_date: string | null;
  custom_logo_url: string | null;
  subscription_canceled: boolean;
  /** Stripe identifiers, populated by the webhook/checkout flow. */
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  subscription_status?: string | null;
  price_id?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  subscription_paused?: boolean;
  created_at: string;
  generation_preferences: Record<string, unknown> | null;
  experiment_assignment: string | null;
  watermark_add_on: boolean;
  lang_add_on: boolean;
  script_add_on: boolean;
  video_instruction_add_on: boolean;
  logo_add_on: boolean;
  team_add_on: boolean;
  api_add_on: boolean;
  longer_videos_add_on: boolean;
}

export interface Video {
  id: string;
  user_id: string;
  job_id: string | null;
  title: string;
  status: VideoStatus;
  kind: GenerationKind;
  engine: Engine;
  style: string;
  image_style: string | null;
  pen_style: string | null;
  language: string;
  display_language: string;
  duration_seconds: number;
  visibility: Visibility;
  script: string | null;
  /** Scene breakdown used by the renderer (narration + suggested visual). */
  scenes: Array<{ index: number; narration: string; visual: string; startSeconds: number }> | null;
  video_url: string | null;
  poster_url: string | null;
  /** What the media URLs actually serve. */
  media_format: "mp4" | "svg";
  watermark: boolean;
  is_audio_only: boolean;
  variant_of: string | null;
  variant_language: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  user_id: string;
  video_id: string | null;
  status: JobStatus;
  stage: string;
  progress: number;
  kind: GenerationKind;
  script: string | null;
  error: string | null;
  /** Raw multipart/JSON fields, kept so /api/regenerate and polling can replay them. */
  request: Record<string, unknown>;
  variant_video_ids: string[];
  is_script_generation: boolean;
  is_audio_only: boolean;
  created_at: string;
  updated_at: string;
  /** Epoch ms when the simulated render completes. */
  completes_at: number;
  /** Epoch ms when the real FFmpeg render was kicked off (null in storyboard mode). */
  render_started_at?: number | null;
}

export interface Character {
  id: string;
  user_id: string;
  name: string;
  description: string;
  image_url: string | null;
  created_at: string;
}

export interface SavedStyle {
  id: string;
  user_id: string;
  name: string;
  prompt: string;
  image_style: string | null;
  preview_url: string | null;
  created_at: string;
}

export interface VoiceClone {
  id: string;
  user_id: string;
  name: string;
  status: "ready" | "training" | "failed";
  language: string;
  sample_count: number;
  created_at: string;
}

export interface CustomMusic {
  id: string;
  user_id: string;
  name: string;
  url: string;
  duration_seconds: number;
  created_at: string;
}

export interface Playlist {
  id: string;
  user_id: string;
  name: string;
  description: string;
  video_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  key_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface Organization {
  id: string;
  name: string;
  owner_id: string;
  seat_count: number;
  member_ids: string[];
  created_at: string;
}

export interface Upload {
  id: string;
  user_id: string;
  filename: string;
  content_type: string;
  size: number;
  storage_path: string;
  url: string;
  created_at: string;
}

export interface Changelog {
  id: string;
  version: string;
  title: string;
  summary: string;
  body: { feature: string[] };
  released_at: string;
}

export interface SystemStatus {
  force_show: boolean;
  force_hide: boolean;
  auto_detect_enabled: boolean;
  title: string;
  message: string;
  severity: "info" | "warning" | "error";
}

export interface AdminRole {
  user_id: string;
  role: "owner" | "admin" | "editor" | "viewer";
  permissions: string[];
}

/** Webhook/idempotency record: one row per processed Stripe event. */
export interface BillingEvent {
  id: string;
  type: string;
  user_id: string | null;
  received_at: string;
}

export interface Database {
  version: number;
  users: User[];
  credits: CreditAccount[];
  videos: Video[];
  jobs: Job[];
  characters: Character[];
  styles: SavedStyle[];
  voice_clones: VoiceClone[];
  custom_music: CustomMusic[];
  playlists: Playlist[];
  api_keys: ApiKey[];
  organizations: Organization[];
  uploads: Upload[];
  changelogs: Changelog[];
  system_status: SystemStatus;
  admin_roles: AdminRole[];
  billing_events?: BillingEvent[];
  updated_at: string;
}

/** The subset of a user that the browser is allowed to see. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  display_name: string;
  provider: User["provider"];
  avatar_url: string | null;
}
