# Implementation notes

How `REPORT.md` maps onto this codebase, what is real vs. simulated, and where to plug in
production services. Read `README.md` first for usage.

## 1. Stack and layout

- **Next.js 15 (App Router) + React 19 + TypeScript**, no CSS framework (one hand-written
  stylesheet), no database driver, no external SaaS.
- All persistence is a single JSON document at `.data/db.json` with atomic writes and an
  in-process mutex. This keeps the clone dependency-free and makes state easy to inspect/reset.
- Server-only modules begin with `import "server-only"` so secrets and fs access cannot leak
  into a client bundle.

```
src/
  app/
    page.tsx                     landing + mock sign-in (report §4)
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
    db.ts                        JSON store, mutex, seed
    repo.ts                      all data access
    auth.ts                      HMAC sessions, cookie + bearer
    api-auth.ts                  x-api-key auth for public API
    features.ts                  feature-gate bypass (all true)
    http.ts                      envelopes, parsing, SSRF-guarded fetch
    storage.ts                   local upload storage
    generation/                  request normalization, script, pipeline
    media/svg.ts                 simulated preview/poster renderer
    billing/                     plan catalogue + mock billing
    mcp/server.ts                MCP tools and JSON-RPC handler
scripts/
  smoke.mjs                      end-to-end API test
  make-billing-routes.mjs        regenerates the 11 mock billing routes
```

## 2. Requirement → file map (by report section)

| Report | Requirement | Implementation |
| --- | --- | --- |
| §3 | Hosted surfaces (`video.golpoai.com`, API docs, MCP, S3 media) | Local equivalents: `/`, `/api-docs`, `/mcp`, `/api/media/*`; uploads in `.data/uploads` |
| §4 | Google + Microsoft sign-in, token in `localStorage`, provider list | `src/components/SignInPanel.tsx`, `src/app/api/auth/sign-in/route.ts`, `src/lib/auth.ts` |
| §4 | Session recovery / redirect after login | `requireSessionUser()` in `src/lib/auth.ts`, `?redirect=` support in `src/app/page.tsx` |
| §5 | Playground startup BFF calls (11 routes) | Client calls in `src/components/Playground.tsx`; routes under `src/app/api/*`; live status panel |
| §5 | Credits/plan read from `user_credits` | `getBalance()` in `src/lib/billing/mock-billing.ts` over `CreditAccount` |
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
| §8 | 11 billing BFF routes | `src/app/api/{create-stripe-session, plan-upgrade/*, annual-upgrade/*, …}` (all mocked) |
| §9 | Tables: `user_credits`, `api_key`, `organizations`, `system_status`, … | `src/lib/types.ts` + `db.ts` seed |
| §10 | Supabase, S3, OpenAI ads, analytics | Local stand-ins; outbound calls disabled (`track-openai-ads-event`) |
| §11 | Library filters, playlists, characters, styles, voices, music, avatars | `/api/videos`, `/api/playlists`, `/api/characters*`, `/api/saved-styles`, `/api/clone-voice`, `/api/upload-custom-music`, `/api/*avatars*` |
| §11 | Feature gating per plan | Bypassed in `src/lib/features.ts` with the real requirement map kept |
| §12 | Production defects (404 billing routes, etc.) | Deliberate deviations listed below |
| §13 | Unknowns (models, rate limits, per-minute credit rate) | Marked as inference/TODO where relevant |

## 3. Authentication

Production uses Supabase GoTrue and stores `sb-…-auth-token` in `localStorage`. Locally:

- `POST /api/auth/sign-in` accepts `{ provider, email, name, redirect }`, upserts the user,
  mints an HMAC-SHA256 token (`sub`, `email`, `provider`, `iat`, `exp`), and sets it as the
  httpOnly `golpo_session` cookie. The token is also returned in the body, and the client writes
  it to `localStorage["sb-local-auth-token"]` to mirror the dashboard.
- BFF routes resolve identity from `Authorization: Bearer …` first, then the cookie
  (`getUserFromRequest`). This mirrors the real client forwarding its Supabase token.
- Public API routes (`/api/v1`, `/api/v2`, `/api/mcp`) use `x-api-key` instead. Keys are stored as
  SHA-256 hashes; `last_used_at` is updated on use; revocation is a soft delete.
- Sign-out clears the cookie; the client removes its storage entry on the next sign-in.

**TODO(REAL-AUTH):** replace `src/lib/auth.ts` with `@supabase/ssr`, Google + Microsoft OAuth and
the callback route. Downstream code only calls `getSessionUser()` / `getUserFromRequest()`.

## 4. Data model

`src/lib/types.ts` mirrors the observable PostgREST shapes: `User`, `CreditAccount`
(`user_credits` with every add-on flag), `Video`, `Job`, `Character`, `SavedStyle`, `VoiceClone`,
`CustomMusic`, `Playlist`, `ApiKey`, `Organization`, `Upload`, `Changelog`, `SystemStatus`,
`AdminRole`.

`src/lib/db.ts`:

- Seeds one demo user (`demo@golpo.local`), a welcome video, an organization, a changelog, the
  system-status row and the development API key.
- `withDb(fn)` serializes all mutations through a promise chain, then writes
  `db.json.<pid>.tmp` and renames it atomically.
- `readDb()` returns the in-memory snapshot; callers never mutate it outside `withDb`.

Reset by deleting `.data/` while the server is stopped.

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

Script generation is deterministic local composition (`src/lib/generation/script.ts`), with
sentence splitting into scenes used by the SVG renderer. Audio-only (“podcast”) uses a different
stage label set.

**Seams for a real backend**

- `startGeneration` / `syncJob` — replace body with a render-vendor call and keep the response
  shape (`JobSnapshot`).
- `src/lib/generation/script.ts` — replace `buildScript` with an LLM call.
- `src/lib/media/svg.ts` — return MP4 + real poster URLs instead of SVG.

Environment knobs: `GOLPO_SIMULATED_RENDER_MS` (default 14 s) and
`GOLPO_MAX_CONCURRENT_JOBS` (default 5, returns the verbatim 409 concurrency error).

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

## 8. Billing mock and feature gates

- `MOCK_INFINITE_CREDITS = 999999` is returned regardless of stored state;
  `getBalance()` hard-codes it. `chargeCredits()` is a no-op that reports what it *would* charge.
- `mockBillingActionResult()` handles all 11 intents, returns `{ success, mocked, message }` and
  a redirect for checkout intents. No network calls, no Stripe SDK.
- `estimateCredits()` documents the inferred rate (10 credits/min; audio-only ×0.1; stock avatar
  +3/min; custom avatar +5/min). The real rate is not observable (`REPORT.md` §13).
- `src/lib/features.ts` returns `true` for every feature and keeps `FEATURE_REQUIREMENTS`, the
  per-feature minimum plan, so restoring gates is a one-function change.

TODO markers are written as `TODO(REAL-BILLING)`, `TODO(REAL-AUTH)`, `TODO(REAL-GATING)`,
`TODO(REAL-GENERATION)`, `TODO(REAL-RENDER)`, `TODO(REAL-STORAGE)`, `TODO(REAL-EXTRACT)`.

## 9. Deliberate deviations from production

1. `POST /api/get-subscription-details` and `GET /api/active-subscriptions` return 200 with mock
   data. Production 404s on both (§12) and the UI falls back — keeping the 404 would just add
   console noise locally.
2. Generation media is SVG, not MP4. The URL shape is identical, so the UI and API consumers do
   not care.
3. PDF/DOCX script extraction is rejected with a clear 415. The real extractor’s libraries are
   not observable.
4. Voice names, stock avatars and some catalogue values are local stand-ins (marked in
   `src/lib/generation/config.ts`).
5. Analytics, ads and affiliate calls are accepted and ignored; no outbound traffic leaves the
   machine.
6. Email-sending routes (`organizations/invitation`, `tell-your-manager`) record the request and
   return `mocked_email: true`.
7. Rate limiting is not implemented (production limits are unobservable).

## 10. Verification

`npm run build` and `npm run typecheck` pass. `npm run smoke` (with `npm run dev` running)
verifies in one pass:

- landing page, mock sign-in, session, playground rendering;
- all 11 startup BFF routes returning 2xx;
- multipart generation → job → `ready` with 100% progress, video URL, 2 language variants;
- SVG preview/poster rendering;
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
