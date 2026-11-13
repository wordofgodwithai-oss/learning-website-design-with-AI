# Implementation notes

How `REPORT.md` maps onto this codebase, what is real vs. simulated, and where to plug in
production services. Read `README.md` first for usage.

## 1. Stack and layout

- **Next.js 15 (App Router) + React 19 + TypeScript**, no CSS framework (one hand-written
  stylesheet), and MySQL 8 through `mysql2`. External SaaS is optional: Groq and Stripe are only
  used when their credentials are present (`src/lib/integrations.ts`).
- State lives in real MySQL tables (`db/schema.sql`), with JSON columns for nested scene, render
  and membership data. The app keeps one in-memory snapshot and writes changed rows in a single
  transaction per request (`src/lib/db.ts`). The first boot imports the legacy `.data/db.json`.
- Server-only modules begin with `import "server-only"` so secrets and fs access cannot leak
  into a client bundle.

```
src/
  app/
    page.tsx                     landing + email/password and demo sign-in (report §4)
    playground/page.tsx          server guard + account balances
    library/page.tsx             library feed
    v/[id]/page.tsx              shareable video detail page
    pricing/page.tsx             plan catalogue (report §8)
    api-docs/page.tsx            REST v1/v2 reference (report §7)
    mcp/page.tsx                 MCP documentation
    api/…                        BFF, public API, MCP, media
  components/                    client UI (Playground, Library, SignIn, shell)
  lib/
    types.ts                     data model
    db.ts                        MySQL snapshot store, diff writer, legacy import, seed
    mysql.ts                     connection pool, query and transaction helpers
    password.ts                  scrypt password hashing
    repo.ts                      all data access, users, sessions, API keys
    auth.ts                      opaque DB sessions, cookie + bearer
    auth-response.ts             shared sign-in/sign-up response envelope
    api-auth.ts                  x-api-key auth for public API
    features.ts                  plan + add-on entitlement checks
    integrations.ts              mode resolution (groq/ffmpeg/stripe)
    http.ts                      envelopes, parsing, SSRF-guarded fetch
    storage.ts                   local upload storage
    generation/                  request normalization, script provider, pipeline
    media/render.ts              real MP4 renderer (FFmpeg) + JPEG poster
    media/svg.ts                 storyboard fallback renderer
    billing/                     constants, shared helpers, mock + Stripe + facade
    mcp/server.ts                MCP tools and JSON-RPC handler
db/schema.sql                    MySQL tables (users, sessions, videos, jobs, …)
scripts/
  db-setup.mjs                   creates the database and applies the schema
  smoke.mjs                      end-to-end API test
  make-billing-routes.mjs        legacy mock-route generator (not used by the app)
```

## 2. Requirement → file map (by report section)

| Report | Requirement | Implementation |
| --- | --- | --- |
| §3 | Hosted surfaces (`video.golpoai.com`, API docs, MCP, S3 media) | Local equivalents: `/`, `/api-docs`, `/mcp`, `/api/media/*`; uploads in `.data/uploads` |
| §4 | Sign-in, token in `localStorage`, provider list | `src/components/SignInPanel.tsx` (email/password + demo), `src/lib/auth.ts`, `src/app/api/auth/*` |
| §4 | Session recovery / redirect after login | `requireSessionUser()` in `src/lib/auth.ts`, `?redirect=` support in `src/app/page.tsx` |
| §5 | Playground startup BFF calls (11 routes) | Client calls in `src/components/Playground.tsx`; routes under `src/app/api/*`; live status panel |
| §5 | Credits/plan read from `user_credits` | `getBalance()` in `src/lib/billing/index.ts` (mock or Stripe) over `CreditAccount` |
| §5 | Changelog modal, broadcast banner | `/api/changelogs`, `/api/broadcast`, seeded `changelogs`/`system_status` |
| §6 | Multipart `/api/generate`, field vocabulary, retry/timeout | `normalizeGenerationInput()` in `src/lib/generation/request.ts`; retry/abort in `Playground.tsx` |
| §6 | Poll `/api/generate/poll`, stages, 10-minute ceiling, resume | `syncJob()` in `src/lib/generation/pipeline.ts`; `localStorage["golpo:lastGeneration"]` resume |
| §6 | Error copy incl. concurrency and support address | `src/lib/generation/errors.ts` (verbatim strings) |
| §6 | Language variants → sibling videos | `finalize()` in `pipeline.ts`, capped at 10 |
| §6 | Script-only mode | `just_return_script` → `script_ready` job, no video row |
| §7 | REST v1 (multipart) | `src/app/api/v1/**` |
| §7 | REST v2 (JSON vocabulary) | `src/app/api/v2/**` |
| §7 | MCP server, 6 tools | `src/lib/mcp/server.ts`, `src/app/api/mcp/route.ts` |
| §7 | 15 MB upload cap | `MAX_UPLOAD_BYTES` in `src/lib/generation/config.ts` |
| §8 | Plans, credits, add-ons, annual discount, PAYG tiers | `src/lib/billing/constants.ts`, `/pricing` |
| §8 | 11 billing BFF routes + webhook | Intent handlers in `src/lib/billing/{index,stripe-billing}.ts`; routes under `src/app/api/*`; `/api/stripe/webhook` |
| §9 | Tables: `user_credits`, `api_key`, `organizations`, `system_status`, … | `db/schema.sql` and `src/lib/types.ts`; rows map 1:1 to the TypeScript fields |
| §10 | Supabase, S3, OpenAI ads, analytics | Auth is local MySQL; Groq scripts/transcription/TTS are optional integrations; ads/analytics remain no-ops (`track-openai-ads-event`) |
| §11 | Library filters, playlists, characters, styles, voices, music, avatars | `/api/videos`, `/api/playlists`, `/api/characters*`, `/api/saved-styles`, `/api/clone-voice`, `/api/upload-custom-music`, `/api/*avatars*` |
| §11 | Feature gating per plan | `src/lib/features.ts` checks the ledger plan/add-ons; local unlimited bypasses it |
| §12 | Production defects (404 billing routes, etc.) | Deliberate deviations listed below |
| §13 | Unknowns (models, rate limits, per-minute credit rate) | Marked as inference/TODO where relevant |

## 3. Authentication

Accounts and sessions are stored in MySQL, not Supabase:

- `POST /api/auth/sign-up` validates the email/password, hashes the password with scrypt
  (`src/lib/password.ts`) and creates the account plus its mock credit ledger row.
- `POST /api/auth/sign-in` accepts either `{ provider: "dev" }` for the pre-seeded demo account or
  `{ email, password }` for a password account. Invalid credentials return a generic `401`.
- A successful sign-in inserts a row into `sessions` with a random 32-byte token; only its SHA-256
  is stored. The token is returned in the body and set as the httpOnly `golpo_session` cookie.
- BFF routes resolve identity from `Authorization: Bearer …` first, then the cookie
  (`getUserFromRequest`). The bearer token is the same session token the browser holds.
- Public API routes (`/api/v1`, `/api/v2`, `/api/mcp`) use `x-api-key` instead. Keys are stored as
  SHA-256 hashes; `last_used_at` is updated on use; revocation is a soft delete.
- `POST /api/auth/sign-out` deletes the session row and clears the cookie, so the bearer token is
  revoked immediately.
- `users.password_hash` and the `sessions` table are deliberately excluded from the in-memory
  `Database` model, so a hash can never be serialised into an API response.

Accounts imported from the old `.data/db.json` have no password hash; they can use the demo account
or register a new address.

## 4. Data model

`src/lib/types.ts` mirrors the observable PostgREST shapes: `User`, `CreditAccount`
(`user_credits` with every add-on flag), `Video`, `Job`, `Character`, `SavedStyle`, `VoiceClone`,
`CustomMusic`, `Playlist`, `ApiKey`, `Organization`, `Upload`, `Changelog`, `SystemStatus`,
`AdminRole`.

`src/lib/db.ts`:

- Ensures `db/schema.sql` has been applied, then imports `.data/db.json` if the tables are empty;
  otherwise it seeds one demo user (`demo@golpo.local`), a welcome video, an organization, a
  changelog, the system-status row and the development API key.
- `withDb(fn)` serializes mutations through a promise chain, then diffs the snapshot and writes
  only changed rows (UPSERT/DELETE) in one MySQL transaction. A failed write discards the cached
  snapshot so the next read reloads committed state.
- `readDb()` returns the shared in-memory snapshot; callers never mutate it outside `withDb`.
- JSON columns (`scenes`, `render`, `request`, `variant_video_ids`, `member_ids`, …) round-trip
  through `JSON.parse`/`JSON.stringify`; timestamps are DATETIME(3) in UTC.

Reset by dropping the database (`npm run db:setup` recreates it) and deleting `.data/` while the
server is stopped.

## 5. Generation pipeline

`POST /api/generate`:

1. Authenticate (bearer or API key).
2. `readGenerationBody()` parses multipart (files are persisted and replaced with local URLs) or
   JSON. JSON is also accepted so the route is easy to script.
3. `normalizeGenerationInput()` flattens the multipart fields **and** the optional
   `request_payload` JSON into one normalized object (engine, style, durations, variants,
   narration, media arrays, v2 vocabulary, …).
4. `validateGenerationInput()` enforces prompt presence/length and the 10-variant cap.
5. `startGeneration()` writes a `Job` and a placeholder `Video` in one transaction; returns
   immediately.

`POST /api/generate/poll` calls `syncJob()`, which derives progress from wall-clock time
(`completes_at`), advances the stage, persists it, and finalizes once. Finalization sets
`video_url`/`poster_url`, flips the video to `ready` and creates one sibling video per requested
language variant (`variant_of` + `variant_language`).

Script generation goes through `writeScript()` in `src/lib/generation/script-provider.ts`:
Groq chat completions when `GROQ_API_KEY` is set (plain `fetch` against the OpenAI-compatible
`/openai/v1` surface, timeout), otherwise the deterministic local writer in
`script.ts`. The model is asked for a word budget derived from the requested duration
(~2.3 words/second, the slow end of the observed TTS range) and for one scene per ~9 seconds.
If a draft comes back short, the provider retries with an explicit expansion prompt (up to three
attempts) and splits long scenes at sentence boundaries, so a 20-second request produces a
20-second script instead of a 6-second one. Groq failures fall back to the local writer so a job
never fails because of the provider. Reasoning models such as `openai/gpt-oss-120b` skip
`response_format: json_object`, which they reject, and get extra token headroom for hidden
reasoning.

Narration (`src/lib/media/audio.ts`) uses Groq Orpheus for English when it is available. Orpheus
caps input at 200 characters, so scenes are split into ~190-character chunks and the WAV parts are
joined by FFmpeg. Neural voices insert long dramatic pauses at commas and around numbers, so every
narration clip is tightened (edge silence trimmed, gaps over 0.35 s squeezed to 0.16 s) before the
renderer plans the timeline from its real length. Because the free Orpheus quota is only 3,600
tokens/day, English automatically falls back to the free Microsoft Edge read-aloud voices, which
also cover 50+ other languages (`GOLPO_TTS_MODE=edge` forces them). Audio uploads to
`/api/extract-script-source` are transcribed by Groq Whisper (`whisper-large-v3`, `verbose_json`,
word + segment timestamps, language auto-detected).

The requested duration is enforced at two points: the writer aims for ~2.3 words/second, and the
renderer measures the finished narration and applies a small `atempo` pace change (0.9×–1.25×) so
the speech itself fills the requested runtime; any residual shortfall is spread across all scenes
instead of freezing one frame at the end. A script that runs long loses trailing sentences, never
whole scenes, so the story stays intact.

Scene artwork comes from `src/lib/media/artwork.ts` when a free provider is configured:
Cloudflare Workers AI FLUX.1-schnell (10,000 neurons/day, about 100 images) or Pollinations (no
key, one image per 45 seconds per IP). Generated art is cached by prompt hash in
`.data/media/art`, post-processed to match the sketch/canvas theme, and replaced by the bundled
vector doodles (`illustration.ts`) whenever the provider is off or fails.

Rendering (`src/lib/media/render.ts`) uses the binaries bundled by `ffmpeg-static` /
`ffprobe-static` plus `sharp` for scene stills. It honours orientation (16:9, 9:16, 1:1), every
canvas/sketch style, colour/monochrome, pacing, `skip_animation`, watermark and logo, presenter
avatar, uploaded media, own-narration PiP (the webcam clip is looped and overlaid, split or
fullscreen), podcast waveforms, and custom or generated music. The timeline is fitted to the
requested duration from the measured narration (pace nudge, then a spread across scenes), so a
20-second request ships a ~20-second video even when the model's script or the voice's pacing
drifts. Once the simulated
progress reaches 100% the job moves to 97% / `encoding`, the FFmpeg render runs **outside** the
database mutex, and a second transaction finalizes the job. A background worker
(`src/lib/generation/worker.ts`) advances active jobs every `GOLPO_JOB_TICK_MS` even when no
browser is polling, resumes queued work after a restart, and fails jobs older than
`GOLPO_JOB_STALE_MS`. The first caller claims a render with a token stored on the job, so polling,
the worker and duplicate module instances cannot start it twice. A render error, or a render stale
for more than 10 minutes after a restart, falls back to the animated SVG storyboard instead of
hanging the job. Language variants are marked `processing` when created, get a Groq-translated script,
render their own narration, and only become `ready` once their MP4 exists (a failed translation is
recorded on the row). Politeness: media is served with `Range`/`206` support and a JPEG poster.

**Real backend seams**

- `startGeneration` / `syncJob` — swap the simulated clock for a render-vendor call while keeping
  the `JobSnapshot` response shape.
- `src/lib/generation/script-provider.ts` — provider selection and fallback.
- `src/lib/media/render.ts` — the media synthesis boundary.

Environment knobs: `GOLPO_SIMULATED_RENDER_MS` (default 14 s),
`GOLPO_MAX_CONCURRENT_JOBS` (default 5, returns the verbatim 409 concurrency error),
`GOLPO_JOB_TICK_MS` (default 1500) and `GOLPO_JOB_STALE_MS` (default 6 h), plus the integration
modes in `src/lib/integrations.ts`.

## 6. BFF route inventory

Account/session: `auth/sign-in`, `auth/sign-out`, `auth/session`, `auth/token`.

Playground startup: `referral`, `get-user-characters`, `saved-styles`, `get-user-voice-clones`,
`get-user-custom-music`, `organizations/credits`, `avatars`, `stock-avatars`, `changelogs`,
`get-subscription-details`, `active-subscriptions`.

Generation: `generate`, `generate/poll`, `regenerate`, `videos`, `videos/[id]`,
`videos/create-record`, `upload-generation-files`, `upload-logo`, `upload-proxy`,
`extract-script-source`.

Assets: `characters` CRUD, `clone-voice`, `voice-clones/[id]`, `upload-custom-music`,
`custom-music/[id]`, `avatars/upload`, `media/[videoId]/{preview,poster}`,
`media/uploads/[fileId]`.

Org/keys/misc: `organizations/{create,details,invitation}`, `api-keys`, `api-keys/[id]`,
`create-api-key`, `playlists`, `playlists/[id]`, `broadcast`, `video-surveys/pending`,
`custom-scene-selection/defaults`, `track-openai-ads-event`, `affiliate/visit`,
`tell-your-manager`.

Billing (mock): `create-stripe-session`, `plan-upgrade/{checkout,complete}`,
`annual-upgrade/{options,checkout}`, `create-customer-portal-session`, `cancel-subscription`,
`pause-subscription`, `resume-subscription`, `can-pause-subscription`, `remove-addon`.
Regenerate with `node scripts/make-billing-routes.mjs`.

All error envelopes are `{ success: false, error: string, code? }` (public API uses the same
shape). Every route returns 401 for missing credentials unless it is explicitly public
(changelogs, media, broadcast).

## 7. Public API and MCP

**v1** (`/api/v1`, multipart, `x-api-key`): generate, upload-file, list videos, get/update/delete
video, status, custom styles.

**v2** (`/api/v2`, JSON, `x-api-key`): generate with the v2 vocabulary
(`golpo_video_engine`, `canvas_style_variant`, `sketch_style_variant`, `narration_voice`,
`narration_language`, `scene_pacing`, `pen_animation_style`, `watermark`, `background_track`,
`video_orientation`, `onscreen_text_language`, `visibility`), title/visibility patch, custom
styles.

**MCP** (`POST /api/mcp`): JSON-RPC 2.0 over HTTP. Supports `initialize`, `tools/list`,
`tools/call`, `ping`, notifications (202) and empty `resources/list` / `prompts/list`. Tools:
`generate_video`, `upload_file` (base64, 15 MB cap), `list_videos`, `get_video`,
`check_status`, `status`. Errors are JSON-RPC errors or tool results with `isError: true`.

## 8. Billing and feature gates

The facade `src/lib/billing/index.ts` picks an implementation from
`GOLPO_BILLING_MODE`/`STRIPE_SECRET_KEY`; routes and pages never import a provider directly.

**Mock mode (default)** — `mock-billing.ts`

- `MOCK_INFINITE_CREDITS = 999999` is returned regardless of stored state; `chargeCredits()` is a
  no-op that reports what it *would* charge.
- `mockBillingActionResult()` handles all 11 intents, returns `{ success, mocked, message }` and a
  redirect for checkout intents. No network calls, no Stripe SDK.

**Stripe mode** — `stripe-billing.ts`

- Plans use inline `price_data` (no dashboard products). Monthly and annual intervals, credit
  packs and the billing portal are all supported.
- Subscription state lives on the local `user_credits` row (`stripe_customer_id`,
  `stripe_subscription_id`, `status`, `current_period_end`, pause/cancel flags). The webhook at
  `/api/stripe/webhook` is the source of truth and de-duplicates events through `billing_events`.
- Credits are reset to the plan allowance on subscription creation and on `invoice.paid`, and
  debited per generation in the same transaction that creates the job.
- `GET/POST` helpers still answer `/api/get-subscription-details` and `/api/active-subscriptions`,
  so the dashboard contract is unchanged.
- `GOLPO_UNLIMITED_DEV=1` keeps unlimited credits while Stripe is configured (useful in tests).

**Feature gates** — `src/lib/features.ts`

- `isFeatureUnlocked(feature, { plan, unlimited, addons })` compares the plan rank against
  `FEATURE_REQUIREMENTS` (REPORT.md §11) and lets matching add-ons unlock a feature early.
- `local-unlimited` (mock mode) short-circuits to `true`, so the default clone is fully usable.
- `startGeneration()` enforces gates server-side (podcast, multilingual, AI presenter, own
  narration, user media, logo, music, characters, longer videos) and rejects with the 403
  `plan_required` envelope before writing a script.

`estimateCredits()` documents the inferred rate (10 credits/min; audio-only ×0.1; stock avatar
+3/min; custom avatar +5/min). The real rate is not observable (`REPORT.md` §13).

The old `scripts/make-billing-routes.mjs` generator is kept for reference but the routes now call
the facade and must not be regenerated.

## 9. Deliberate deviations from production

1. `POST /api/get-subscription-details` and `GET /api/active-subscriptions` return 200 with
   ledger data. Production 404s on both (§12) and the UI falls back — keeping the 404 would just
   add console noise locally.
2. Rendering uses bundled FFmpeg to produce MP4 + JPEG; the production vendor is unobservable.
   SVG storyboards remain as the failure fallback.
3. PDF/DOCX script extraction runs locally through `unpdf` and `mammoth`. Scanned PDFs without a
   text layer are rejected with a 422 because OCR is not bundled.
4. Voice names, stock avatars and some catalogue values are local stand-ins (marked in
   `src/lib/generation/config.ts`).
5. Analytics, ads and affiliate calls are accepted and ignored; only Groq, MySQL and Stripe
   make outbound calls, and only when configured.
6. Email-sending routes (`organizations/invitation`, `tell-your-manager`) record the request and
   return `mocked_email: true`.
7. Rate limiting is not implemented (production limits are unobservable).

## 10. Verification

`npm run build` and `npm run typecheck` pass. `npm run smoke` (with `npm run dev` running)
verifies in one pass:

- landing page, mock sign-in, session, playground rendering;
- all 11 startup BFF routes returning 2xx;
- multipart generation → job → `ready` with 100% progress, video URL, 2 language variants;
- MP4 preview playback (including byte ranges), JPEG poster;
- library listing;
- API v1 generate + status + list;
- API v2 generate;
- MCP `tools/list` (6 tools) and `tools/call`;
- 401 for unauthenticated BFF access and invalid API keys.

## 11. Security notes (local only)

- Session signing uses a fixed development secret unless `GOLPO_SESSION_SECRET` is set. Do not
  deploy this build publicly.
- `safeFetch()` blocks loopback, RFC1918, link-local and CGNAT addresses and caps response size,
  because `/api/extract-script-source` and `/api/upload-proxy` accept user-supplied URLs.
- Uploads are size-capped per route (15 MB media, 25 MB music, 10 MB avatars/proxy, 5 MB logos,
  2 MB script imports) and filenames are sanitized.
- API keys are stored hashed; the plaintext is shown once at creation.
