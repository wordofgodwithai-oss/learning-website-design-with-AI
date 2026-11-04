# Golpo Local

A full local reconstruction of the [Golpo AI](https://video.golpoai.com) dashboard, built from
`REPORT.md`. It runs entirely on your machine at **http://localhost:3000** with no external
services required, and upgrades itself to real providers when you add credentials.

Everything is optional and switched from `.env.local`:

| Capability | Default (no keys) | With credentials |
| --- | --- | --- |
| Scripts | Deterministic local writer | OpenAI chat completions |
| Narration | Silent | OpenAI text-to-speech |
| Video | MP4 via bundled FFmpeg | MP4 via bundled FFmpeg |
| Auth | Local HMAC sessions | Supabase Google/Microsoft OAuth |
| Billing | Mock, 999,999 credits | Stripe Checkout + webhooks |

Without `STRIPE_SECRET_KEY` billing stays mocked: every account has **999,999 credits**, every
plan feature is unlocked, and no payment flow can charge anything. With Stripe enabled the ledger
becomes real (plan entitlements, per-generation debits, webhook-driven credit grants).

Everything else is implemented and working: the BFF contract, the job pipeline, library
management, the public API and MCP.

> This is a learning reconstruction, not affiliated with Golpo AI. See `REPORT.md` for the
> reverse-engineering notes it was built from and `docs/IMPLEMENTATION.md` for the
> requirement-to-file map.

## Quick start

Requirements: Node.js 20.9+ (tested on Node 26).

```powershell
npm install
npm run dev
```

Open **http://localhost:3000**.

### How to log in

1. Click **Continue with Google** or **Continue with Microsoft** on the landing page.
2. The email is pre-filled with `demo@golpo.local`. Clicking either provider signs you in
   immediately — there is no OAuth round-trip and no password.
3. That account is pre-seeded with a welcome video, an organization and a development API key.
4. Any other email creates a fresh local account with infinite credits on the same click.

The session is an HMAC-signed bearer token in an httpOnly `golpo_session` cookie (also accepted
as `Authorization: Bearer …`), so the BFF and public API behave like the real Supabase-token setup.

### Generate your first video

1. On `/playground`, type a prompt (or import a `.txt` / `.md` / `.srt` script).
2. Pick engine, style, duration, language, voice, variants, watermark, etc.
3. Click **Generate video**. The job is queued, polled and completes in about 14 seconds
   (`GOLPO_SIMULATED_RENDER_MS`).
4. The finished video appears in the Render panel and in `/library`. Click **Open detail** to see
   a `/v/{id}` page with the script, variants and a downloadable poster.

The render pipeline produces a real MP4 with bundled FFmpeg (`ffmpeg-static`), a JPEG
poster and byte-range streaming (`/api/media/{id}/preview`). Narration is silent unless an OpenAI
key is present; without one the video is still rendered. Scripts come from OpenAI when configured
and from a deterministic local writer otherwise. If FFmpeg fails, the job falls back to an
animated SVG storyboard so generation never hard-fails.

## What is implemented

| Area | Status |
| --- | --- |
| Google/Microsoft sign-in, sessions, sign-out | Working (local mock or Supabase OAuth) |
| Playground: prompt, script import, engine/style/language/voice/variants | Working |
| Generation jobs, stage progress, polling, language variants | Working |
| Scripts | Local writer or OpenAI |
| Render | Real MP4 + JPEG poster (FFmpeg), SVG fallback |
| Library: search, filters, visibility, delete, playlists | Working |
| Characters, saved styles, voice clones, custom music, avatars | Working (stored locally) |
| Organizations, API keys, changelogs, broadcast/status | Working |
| Billing routes (11) + `/api/stripe/webhook` | Mock or Stripe |
| `/api/get-subscription-details`, `/api/active-subscriptions` | 200 locally (production returns 404) |
| Public REST API v1 (multipart) and v2 (JSON) | Working |
| MCP JSON-RPC endpoint with 6 tools | Working |
| PDF/DOCX import | Not implemented (plain text only) |

## Useful commands

```powershell
npm run dev        # dev server on :3000
npm run build      # production build
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit
npm run smoke      # end-to-end API test (dev server must be running)
```

`npm run smoke` signs in, calls all 11 startup BFF routes, generates through the browser path,
polls to `ready`, checks variants, MP4 playback (including byte ranges) and the JPEG poster, then
exercises API v1, API v2, MCP and the 401 paths. It exits non-zero on failure.

## API and MCP

Both use the seeded development key, stored only as a SHA-256 hash:

```
x-api-key: glp_local_dev_key_change_me
```

Override it with `GOLPO_DEV_API_KEY` **before first run** (the seed is written on first boot).

```powershell
# v1 — multipart
curl.exe -X POST http://localhost:3000/api/v1/videos/generate `
  -H "x-api-key: glp_local_dev_key_change_me" `
  -F "prompt=Explain how DNS works" `
  -F "durationSeconds=30" `
  -F "language=en"

# v2 — JSON
curl.exe -X POST http://localhost:3000/api/v2/videos/generate `
  -H "x-api-key: glp_local_dev_key_change_me" `
  -H "content-type: application/json" `
  -d '{\"prompt\":\"Why is the sky blue?\",\"golpo_video_engine\":\"golpo_sketch\",\"sketch_style_variant\":\"crayon\",\"duration_seconds\":15}'
```

Poll `GET /api/v1/videos/status/{job_id}`. Full reference: `/api-docs` and `/mcp` in the app.

MCP clients can point at `http://localhost:3000/api/mcp` with the `x-api-key` header. Tools:
`generate_video`, `upload_file`, `list_videos`, `get_video`, `check_status`, `status`.

## Configuration

Everything is optional. Create `.env.local` to override.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GOLPO_DATA_DIR` | `./.data` | JSON store and uploads directory |
| `GOLPO_SESSION_SECRET` | dev constant | HMAC secret for session tokens |
| `GOLPO_DEV_API_KEY` | `glp_local_dev_key_change_me` | Seeded API key |
| `GOLPO_SIMULATED_RENDER_MS` | `14000` | Simulated progress duration |
| `GOLPO_MAX_CONCURRENT_JOBS` | `5` | Concurrency cap per user |
| `PORT` | `3000` | Next.js port |
| `GOLPO_SCRIPT_MODE` | `auto` | `auto` → OpenAI when a key exists |
| `OPENAI_API_KEY` | — | Enables real scripts and narration |
| `GOLPO_OPENAI_MODEL` | `gpt-4o-mini` | Script model |
| `GOLPO_OPENAI_TTS_MODEL` / `_VOICE` | `tts-1` / `alloy` | Narration model and voice |
| `GOLPO_RENDER_MODE` | `auto` | `auto` → FFmpeg (bundled binaries) |
| `GOLPO_AUTH_MODE` | `auto` | `auto` → Supabase when URL + anon key exist |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | — | Enables Supabase OAuth |
| `GOLPO_BILLING_MODE` | `auto` | `auto` → Stripe when a secret key exists |
| `STRIPE_SECRET_KEY` | — | Enables real checkout and the credit ledger |
| `STRIPE_WEBHOOK_SECRET` | — | Verifies `/api/stripe/webhook` |
| `GOLPO_APP_URL` | `http://localhost:3000` | Redirect base for Stripe |
| `GOLPO_UNLIMITED_DEV` | off in Stripe mode | Keep unlimited credits while testing |

See `.env.example` for the annotated list. Restart the dev server after editing `.env.local`.

### Enabling real integrations

1. **OpenAI**: set `OPENAI_API_KEY`. Scripts switch to chat completions and narration to TTS.
2. **Supabase**: create a project, enable Google and Microsoft providers, add
   `http://localhost:3000/auth/callback` to the redirect allow-list, then set `SUPABASE_URL` and
   `SUPABASE_ANON_KEY`. The callback mirrors the Supabase identity into the local store and mints
   the same session the BFF already understands.
3. **Stripe**: set `STRIPE_SECRET_KEY` (test mode) and, for webhooks,
   `stripe listen --forward-to localhost:3000/api/stripe/webhook` → copy the `whsec_…` into
   `STRIPE_WEBHOOK_SECRET`. Plans use inline `price_data`, so no dashboard products are required.

## Data and reset

State lives in `./.data`:

- `db.json` — users, credits, videos, jobs, keys, playlists, etc. Written atomically.
- `uploads/` — files from script import, avatars, logos, music, reference media.

To reset everything, stop the server and delete `.data/` — the next request re-seeds the demo
account.

## Known local deviations

These are deliberate and documented in `docs/IMPLEMENTATION.md`:

1. **Billing defaults to mock.** Without `STRIPE_SECRET_KEY`, credits never decrease, all feature
   gates return `true`, and checkout routes return `{ success: true, mocked: true }` with a
   redirect back to the playground. Enabling Stripe switches the ledger to real plan entitlements
   and per-generation debits.
2. **`/api/get-subscription-details` and `/api/active-subscriptions` return 200.** Production
   returns 404 and the UI falls back to the credits row (`REPORT.md` §12). Returning ledger data
   keeps the console clean.
3. **Render is local.** MP4 is produced with bundled FFmpeg and a JPEG poster with sharp. The
   production render vendor is not observable; the SVG storyboard is used only as a fallback.
4. **PDF/DOCX script import is not implemented.** Plain-text formats only (413/415 with copy).
5. **Voice catalogues and stock-avatar IDs are local stand-ins.** Their real values are not
   observable from the shipped client.
6. **Analytics/ads endpoints acknowledge and do nothing**, so no data leaves the machine unless
   you enable OpenAI/Supabase/Stripe.
7. **Per-minute credit pricing is inferred.** The real platform rate is unobservable; the estimate
   is documented in `src/lib/billing/shared.ts`.

Error copy (including `support@golpoai.com`) is kept verbatim from the report for parity.
