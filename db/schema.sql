-- ---------------------------------------------------------------------------
-- Golpo Local — MySQL schema (WAMP / MySQL 8.0+)
--
-- Apply with `npm run db:setup`, which creates the database named by
-- GOLPO_DB_NAME (default: golpo) and runs this file.
--
-- Design notes
--   * Column names match the TypeScript fields in src/lib/types.ts, so rows map
--     to API payloads without a translation layer.
--   * Nested values (scene lists, renderer settings, membership arrays) use
--     JSON columns. Everything the UI filters on is a real indexed column.
--   * Timestamps are DATETIME(3) in UTC; the driver is configured with
--     timezone "Z" so they round-trip as ISO-8601 strings.
--   * No foreign keys: jobs and videos are created/finalised by the worker in
--     separate transactions, and the clone keeps deletes simple.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id             VARCHAR(64)  NOT NULL PRIMARY KEY,
  email          VARCHAR(320) NOT NULL,
  name           VARCHAR(255) NOT NULL,
  display_name   VARCHAR(255) NOT NULL,
  provider       VARCHAR(32)  NOT NULL DEFAULT 'password',
  external_id    VARCHAR(191) NULL,
  avatar_url     TEXT         NULL,
  password_hash  VARCHAR(255) NULL,
  created_at     DATETIME(3)  NOT NULL,
  last_login_at  DATETIME(3)  NOT NULL,
  UNIQUE KEY users_email (email),
  KEY users_external (external_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Opaque bearer/session tokens. Only the SHA-256 of the token is stored, so a
-- database dump cannot be replayed against the app.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   CHAR(64)    NOT NULL PRIMARY KEY,
  user_id      VARCHAR(64) NOT NULL,
  created_at   DATETIME(3) NOT NULL,
  expires_at   DATETIME(3) NOT NULL,
  last_used_at DATETIME(3) NULL,
  KEY sessions_user (user_id),
  KEY sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credits (
  user_id                  VARCHAR(64)  NOT NULL PRIMARY KEY,
  credits                  INT          NOT NULL DEFAULT 0,
  plan                     VARCHAR(64)  NOT NULL DEFAULT 'free',
  email                    VARCHAR(320) NOT NULL,
  name                     VARCHAR(255) NOT NULL,
  stripe_email             VARCHAR(320) NULL,
  next_subscription_date   DATETIME(3)  NULL,
  custom_logo_url          TEXT         NULL,
  subscription_canceled    TINYINT(1)   NOT NULL DEFAULT 0,
  stripe_customer_id       VARCHAR(191) NULL,
  stripe_subscription_id   VARCHAR(191) NULL,
  subscription_status      VARCHAR(64)  NULL,
  price_id                 VARCHAR(191) NULL,
  current_period_end       DATETIME(3)  NULL,
  cancel_at_period_end     TINYINT(1)   NOT NULL DEFAULT 0,
  subscription_paused      TINYINT(1)   NOT NULL DEFAULT 0,
  created_at               DATETIME(3)  NOT NULL,
  generation_preferences   JSON         NULL,
  experiment_assignment    VARCHAR(64)  NULL,
  watermark_add_on         TINYINT(1)   NOT NULL DEFAULT 0,
  lang_add_on              TINYINT(1)   NOT NULL DEFAULT 0,
  script_add_on            TINYINT(1)   NOT NULL DEFAULT 0,
  video_instruction_add_on TINYINT(1)   NOT NULL DEFAULT 0,
  logo_add_on              TINYINT(1)   NOT NULL DEFAULT 0,
  team_add_on              TINYINT(1)   NOT NULL DEFAULT 0,
  api_add_on               TINYINT(1)   NOT NULL DEFAULT 0,
  longer_videos_add_on     TINYINT(1)   NOT NULL DEFAULT 0,
  KEY credits_stripe_customer (stripe_customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS videos (
  id               VARCHAR(64)  NOT NULL PRIMARY KEY,
  user_id          VARCHAR(64)  NOT NULL,
  job_id           VARCHAR(64)  NULL,
  title            VARCHAR(512) NOT NULL,
  status           VARCHAR(32)  NOT NULL,
  kind             VARCHAR(16)  NOT NULL DEFAULT 'video',
  engine           VARCHAR(32)  NOT NULL,
  style            VARCHAR(64)  NOT NULL,
  image_style      VARCHAR(64)  NULL,
  pen_style        VARCHAR(64)  NULL,
  language         VARCHAR(16)  NOT NULL DEFAULT 'en',
  display_language VARCHAR(64)  NOT NULL DEFAULT 'English',
  duration_seconds INT          NOT NULL DEFAULT 60,
  visibility       VARCHAR(16)  NOT NULL DEFAULT 'private',
  script           MEDIUMTEXT   NULL,
  scenes           JSON         NULL,
  video_url        TEXT         NULL,
  poster_url       TEXT         NULL,
  media_format     VARCHAR(8)   NOT NULL DEFAULT 'svg',
  watermark        TINYINT(1)   NOT NULL DEFAULT 0,
  is_audio_only    TINYINT(1)   NOT NULL DEFAULT 0,
  render           JSON         NULL,
  variant_of       VARCHAR(64)  NULL,
  variant_language VARCHAR(16)  NULL,
  error            TEXT         NULL,
  created_at       DATETIME(3)  NOT NULL,
  updated_at       DATETIME(3)  NOT NULL,
  KEY videos_user_created (user_id, created_at),
  KEY videos_job (job_id),
  KEY videos_variant (variant_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jobs (
  id                  VARCHAR(64) NOT NULL PRIMARY KEY,
  user_id             VARCHAR(64) NOT NULL,
  video_id            VARCHAR(64) NULL,
  status              VARCHAR(32) NOT NULL,
  stage               VARCHAR(64) NOT NULL,
  progress            INT         NOT NULL DEFAULT 0,
  kind                VARCHAR(16) NOT NULL DEFAULT 'video',
  script              MEDIUMTEXT  NULL,
  error               TEXT        NULL,
  request             JSON        NOT NULL,
  variant_video_ids   JSON        NOT NULL,
  is_script_generation TINYINT(1) NOT NULL DEFAULT 0,
  is_audio_only       TINYINT(1)  NOT NULL DEFAULT 0,
  created_at          DATETIME(3) NOT NULL,
  updated_at          DATETIME(3) NOT NULL,
  completes_at        BIGINT      NOT NULL DEFAULT 0,
  render_started_at   BIGINT      NULL,
  render_token        VARCHAR(64) NULL,
  KEY jobs_user_status (user_id, status),
  KEY jobs_video (video_id),
  KEY jobs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS characters (
  id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  user_id     VARCHAR(64)  NOT NULL,
  name        VARCHAR(255) NOT NULL,
  description TEXT         NOT NULL,
  image_url   TEXT         NULL,
  created_at  DATETIME(3)  NOT NULL,
  KEY characters_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS styles (
  id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  user_id     VARCHAR(64)  NOT NULL,
  name        VARCHAR(255) NOT NULL,
  prompt      TEXT         NOT NULL,
  image_style VARCHAR(64)  NULL,
  preview_url TEXT         NULL,
  created_at  DATETIME(3)  NOT NULL,
  KEY styles_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS voice_clones (
  id           VARCHAR(64)  NOT NULL PRIMARY KEY,
  user_id      VARCHAR(64)  NOT NULL,
  name         VARCHAR(255) NOT NULL,
  status       VARCHAR(16)  NOT NULL DEFAULT 'ready',
  language     VARCHAR(16)  NOT NULL DEFAULT 'en',
  sample_count INT          NOT NULL DEFAULT 1,
  created_at   DATETIME(3)  NOT NULL,
  KEY voice_clones_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS custom_music (
  id               VARCHAR(64)  NOT NULL PRIMARY KEY,
  user_id          VARCHAR(64)  NOT NULL,
  name             VARCHAR(255) NOT NULL,
  url              TEXT         NOT NULL,
  duration_seconds INT          NOT NULL DEFAULT 0,
  created_at       DATETIME(3)  NOT NULL,
  KEY custom_music_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS playlists (
  id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  user_id     VARCHAR(64)  NOT NULL,
  name        VARCHAR(255) NOT NULL,
  description TEXT         NOT NULL,
  video_ids   JSON         NOT NULL,
  created_at  DATETIME(3)  NOT NULL,
  updated_at  DATETIME(3)  NOT NULL,
  KEY playlists_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS api_keys (
  id           VARCHAR(64)  NOT NULL PRIMARY KEY,
  user_id      VARCHAR(64)  NOT NULL,
  name         VARCHAR(255) NOT NULL,
  prefix       VARCHAR(32)  NOT NULL,
  key_hash     CHAR(64)     NOT NULL,
  created_at   DATETIME(3)  NOT NULL,
  last_used_at DATETIME(3)  NULL,
  revoked_at   DATETIME(3)  NULL,
  UNIQUE KEY api_keys_hash (key_hash),
  KEY api_keys_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS organizations (
  id         VARCHAR(64)  NOT NULL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  owner_id   VARCHAR(64)  NOT NULL,
  seat_count INT          NOT NULL DEFAULT 3,
  member_ids JSON         NOT NULL,
  created_at DATETIME(3)  NOT NULL,
  KEY organizations_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS uploads (
  id           VARCHAR(64)  NOT NULL PRIMARY KEY,
  user_id      VARCHAR(64)  NOT NULL,
  filename     VARCHAR(255) NOT NULL,
  content_type VARCHAR(191) NOT NULL,
  size         BIGINT       NOT NULL DEFAULT 0,
  storage_path TEXT         NOT NULL,
  url          TEXT         NOT NULL,
  created_at   DATETIME(3)  NOT NULL,
  KEY uploads_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS changelogs (
  id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  version     VARCHAR(32)  NOT NULL,
  title       VARCHAR(255) NOT NULL,
  summary     TEXT         NOT NULL,
  body        JSON         NOT NULL,
  released_at DATETIME(3)  NOT NULL,
  KEY changelogs_released (released_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_roles (
  user_id     VARCHAR(64) NOT NULL PRIMARY KEY,
  role        VARCHAR(16) NOT NULL,
  permissions JSON        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_events (
  id          VARCHAR(191) NOT NULL PRIMARY KEY,
  type        VARCHAR(191) NOT NULL,
  user_id     VARCHAR(64)  NULL,
  received_at DATETIME(3)  NOT NULL,
  KEY billing_events_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_status (
  id                  TINYINT      NOT NULL PRIMARY KEY DEFAULT 1,
  force_show          TINYINT(1)   NOT NULL DEFAULT 0,
  force_hide          TINYINT(1)   NOT NULL DEFAULT 0,
  auto_detect_enabled TINYINT(1)   NOT NULL DEFAULT 1,
  title               VARCHAR(255) NOT NULL,
  message             TEXT         NOT NULL,
  severity            VARCHAR(16)  NOT NULL DEFAULT 'info'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_meta (
  k VARCHAR(64) NOT NULL PRIMARY KEY,
  v TEXT        NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
