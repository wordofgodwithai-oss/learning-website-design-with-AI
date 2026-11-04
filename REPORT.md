# Golpo AI — Reverse-Engineering Report

Target: `https://video.golpoai.com` (the "Create a Video | Golpo AI" tab)
Method: REA (static JavaScript application analysis + controlled browser scenarios over CDP)
Date: 2026-11-04

---

## 1. Scope and method

| Layer | Tool / technique | Evidence |
|---|---|---|
| Web app bundles | `rea analyze-javascript-application` on 39 downloaded `/_next/static/chunks/*.js` | `ev_080c7eb34c8126d68b2cca89aafe3bbede459f398c1330ae92f37df527723aff` |
| Page inventory | 39 chunks (~2.29 MB) + 6 route HTML documents fetched | local: `%TEMP%\opencode\golpo-re\chunks` |
| Logged-out runtime | REA `capture_browser_scenario` (connect, CDP 9222) | `ev_8566a0b730f202290ade36d2cb0b421b4cec2be79513983296b955b7c263e243`, `ev_c927cca25860103d30c48a8eaae24ebe47d5830d78d67f06f46bbfa97427e200` |
| Sign-in modal | scenario click on "Try Golpo for Free" | `ev_e4cedf1e7339e7fd1bfbb5b5fedb158c841756754f410142d489a0f3e56b156f` |
| Logged-in runtime | scenario navigation to `/playground`, `/library` | `ev_29b599615a08fcd7ca0eec84910c746f382c6b0e0f9dd8c55760a25e01b59773`, `ev_c8b30c36c7ac364d9431941ad9a28d4590df1973b8afe1f301368665aff92727`, `ev_c186b94363812b6c2f88df0be6a82e268ba710c5b5a1a3b536ce52b48b15c8b0`, `ev_1c6632d2d3254bfa1a43bc57fc1febe7388f8d82f0ecad7440e19a2fa2ad4995` |
| Passive page inspection | `list_browser_targets`, `inspect_web_page` | `ev_7eb1ae47ff04ea9014e6c5d030179239b1e54aa54b2cf176bdfe0d6402cdd86b`, `ev_4f3eb1c3c11da19cae15ce44d27f9e257bac37e3b68253f38edb878c1c61fa5a` |

Notes on method:
- Analysis ran against a **separate Chrome instance** (temporary profile, port 9222). The user's own browser and session were untouched; the user signed in manually in that window.
- Scenario captures had to set `environment.service_workers: "allow"`; with the default `block` policy REA refuses the page because a Google Tag Manager server-side container registers a worker (`server-side-tagging-vpapryno5a-uc.a.run.app/_/service_worker/6al0/sw_iframe.html`).
- Playwright **does not expose request bodies** (`body.state = "not_exposed"`), so multipart shapes below come from static bundle inspection, not from the wire.
- No generation was submitted; all observed calls are read-only page loads and listing endpoints.

---

## 2. What the product is

AI whiteboard / explainer video maker. Prompt / script / document / audio / video in, narrated animated video out. Two rendering engines:

- **Golpo Canvas** (`use_2_0_style`, `image_style`, `pen_style`) — illustrated styles: `chalkboard_white`, `neon`, `whiteboard`, `modern_minimal`, `playful`, `technical`, `editorial`, `marker`, `chalkboard_black_on_white`, `vox` (illustrations), plus compact/expanded variants (`*_compact`, `*_legacy`).
- **Golpo Sketch** (`use_lineart_2_style`, `pacing`) — `classic`, `improved` (beta), `dry erase`, `professional clean`, `crayon`, `infographics`, `creative`, `chalkboard_black_on_white`.

Per pricing page: 45+ languages, language variants, voice cloning, AI presenter avatars (3 credits/min stock, 5 credits/min custom), own narration / PiP webcam, audio-only podcast mode at 10% credit cost, custom styles, character consistency (beta).

---

## 3. Architecture

```
Browser
 ├── video.golpoai.com            Next.js App Router dashboard (React 18/19, webpack)
 │    ├── /playground            generation UI (chunk page-1928bc6e48b57a33.js, 704 KB)
 │    ├── /library               video library
 │    ├── /pricing /gallery /api-docs /mcp /guide/*  marketing + docs
 │    └── /api/*                 Next.js route handlers = BFF for the dashboard
 │         └── proxies to backend (Authorization: Bearer <supabase access_token>)
 ├── api.golpoai.com             Public REST API v1/v2 (x-api-key), base URL shown in the API-key panel
 ├── mcp.golpoai.com/mcp         MCP server (6 tools)
 ├── rhecdzpisnmycczcyjto.supabase.co  Supabase (GoTrue auth + PostgREST + RPC)
 ├── golpo-media / golpo-podcast-inputs / golpo-dev-private   S3 (us-east-2)
 └── Stripe (checkout, portal, subscriptions), PostHog, GTM/GA, TikTok, Meta CAPI, OpenAI Ads
```

The dashboard does **not** call `api.golpoai.com`; it calls its own `/api/*` routes, which hold the server-side credentials. `api.golpoai.com` is only the documented public API (SDK/MCP/API-only tier).

Client-side rendering data (credits, plan) is read **directly from Supabase PostgREST**, not via the BFF.

---

## 4. Authentication and session

- Supabase project `rhecdzpisnmycczcyjto.supabase.co`; GoTrue email/OAuth.
- Sign-in modal offers **Google** and **Microsoft** (`Continue with Google`, `Continue with Microsoft`) — the bundle's OAuth string suggests Google was the original only provider.
- Session stored in `localStorage["sb-rhecdzpisnmycczcyjto-auth-token"]` (observed key; value redacted by REA).
- `sessionStorage["redirectAfterLogin"]` preserves the post-login destination.
- Dashboard BFF calls send `Authorization: Bearer <access_token>`; the Supabase REST calls send `apikey` + `authorization` + `x-client-info` + `accept-profile`.
- Unauthenticated `/playground` is served `200` and then client-redirects to `/`; no `/api/*` call is made.

---

## 5. Dashboard BFF contract (observed on the wire)

Startup sequence on `/playground` (logged in), all `200` unless noted:

| Method | Route | Response shape |
|---|---|---|
| POST | `/api/referral` | `{status, message}` |
| GET | `/api/get-user-characters` | `{success, characters: []}` |
| GET | `/api/saved-styles` | `{success, styles: []}` |
| GET | `/api/get-user-voice-clones` | `{success, user_id, count, voice_clones: []}` |
| GET | `/api/get-user-custom-music` | `{success, user_id, count, custom_music: []}` |
| GET | `/api/organizations/credits` | `{organizations: []}` |
| GET | `/api/avatars` | `{success, avatars: [], stylization_enabled}` |
| GET | `/api/stock-avatars` | (same family) |
| GET | `/api/changelogs?page=1&page_size=3` | `{changelogs:[{id,version,title,summary,body:{feature:[…]},released_at}]}` |
| POST | `/api/get-subscription-details` | **404** `{error}` |
| GET | `/api/active-subscriptions` | **404** `{error}` |

The two 404s are called unconditionally on every playground load and log a console error (`Failed to load resource: 404`). Live routes that the client still requests but the server no longer serves — an unfinished refactor or a removed Stripe-subscription BFF.

Additional BFF routes referenced in bundles (51 total, static): `/api/generate`, `/api/generate/poll`, `/api/regenerate`, `/api/extract-script-source`, `/api/upload-generation-files`, `/api/create-stripe-session`, `/api/plan-upgrade/checkout|complete`, `/api/annual-upgrade/options|checkout`, `/api/create-customer-portal-session`, `/api/cancel-subscription`, `/api/pause-subscription`, `/api/resume-subscription`, `/api/can-pause-subscription`, `/api/remove-addon`, `/api/organizations/create|details|credits|invitation/`, `/api/create-api-key`, `/api/clone-voice`, `/api/voice-clones/`, `/api/avatars/upload`, `/api/save-character|update-character|delete-character`, `/api/custom-music/`, `/api/upload-custom-music`, `/api/playlists[/]`, `/api/videos/create-record`, `/api/videos/`, `/api/video-surveys/pending`, `/api/broadcast`, `/api/track-openai-ads-event`, `/api/tell-your-manager`, `/api/upload-logo`, `/api/upload-proxy`, `/api/custom-scene-selection/defaults`, `/api/affiliate/visit`, `/api/custom-scene-selection/defaults`, `/api/get-subscription-details`, `/api/active-subscriptions`.

---

## 6. Generation pipeline (static analysis)

From `page-1928bc6e48b57a33.js`:

1. `POST /api/generate` — `multipart/form-data`, `Authorization: Bearer <access_token>`, `AbortSignal.timeout(60_000)`, **up to 3 attempts**.
2. Error mapping: `401/403` → "Authentication failed…", `402` → "You don't have enough credits…", `409` → "Multiple video generations detected…", otherwise server `error` text or "…email support@golpoai.com".
3. Pending job written to `localStorage["golpo:lastGeneration"]` = `{startedAt, pending, videoId?, isScriptGeneration, isAudioOnly, variantVideoIds[]}`.
4. `POST /api/generate/poll` — `{job_id, video_id, …}`, 30 s timeout, 2 retries; `kind === "unknown"` polls up to 10 minutes.
5. Long-running status is per `job_id`; language variants produce one `video_id` per language (`variant_video_ids`, `variant_languages`, `variant_display_languages`, `variant_new_scripts`).

Multipart field vocabulary (from `FormData.append(...)` calls):

```
prompt, kind, style, image_style, pen_style, image_generation_model, use_2_0_style,
use_lineart_2_style, use_color, pacing, timing, durationSeconds, language, display_language,
voiceName?, voice_instructions, avatar_renderer, avatar_presentation_mode,
char_consistency_mode, characters, custom_scene_preparation_id,
custom_scene_selection_sentences, skip_animation, just_return_script, script_only_text,
new_script, fill_in, is_edit, is_public, force_watermark, include_watermark,
organization_id, use_organization_credits, custom_music_url, musicName,
logo_url, logo_placement, style_reference, media_files, media_file_types,
media_file_descriptions, media_file_use_as_is, user_images, user_images_description,
user_videos, user_videos_description, user_video_avatar_modes, user_audio_in_video,
own_narration_avatar_id, own_narration_avatar_duration_seconds, own_narration_pip_position,
own_narration_split_size, own_narration_video_mode, own_narration_webcam_crop_x,
use_prepared_narration_fallback, variant_languages, variant_display_languages,
variant_new_scripts, variant_video_ids, request_payload, upload_urls,
user_email, user_id
```

No model identifiers are present client-side; vendor/model selection is server-side.

---

## 7. Public API and MCP

Documented REST API (`/api-docs`):

- v1: `POST /api/v1/videos/generate`, `POST /api/v1/videos/upload-file` (15 MB cap), `GET /api/v1/videos`, `GET|PATCH|DELETE /api/v1/videos/{video_id}`, `GET /api/v1/videos/status/{job_id}`, `/api/v1/custom-styles`.
- v2: `POST /api/v2/videos/generate` (JSON body), `PATCH /api/v2/videos/{video_id}` (title/visibility only), `POST /api/v2/custom-styles`.
- Auth `x-api-key`; v2 uses `golpo_video_engine: golpo_canvas|golpo_sketch`, `canvas_style_variant`, `sketch_style_variant`, `narration_voice`, `narration_language`, `scene_pacing`, `pen_animation_style`, `watermark`, `background_track`, `video_orientation`, `own_narration_*`, `visibility`, `onscreen_text_language`.
- API-only tier: `$1 = 1 credit`, 1 min = 2 credits, $200 minimum (~100 min). Not part of platform plans.
- SDKs: Python (`golpoai`) v2.0 with `create_video`/`create_podcast`/`get_video_status`; Node (`@golpoai/sdk`) v1.0.2 with `createVideo`/`createPodcast`.
- Atlassian: Jira + Confluence apps.

MCP (`https://mcp.golpoai.com/mcp`), 6 tools: `generate_video`, `upload_file`, `list_videos`, `get_video`, `check_status`, `status`.

---

## 8. Billing, plans, credits

Observed pricing (`/pricing`):

| Plan | Price/mo | Credits/mo | Notes |
|---|---|---|---|
| Free | $0 | — | one 1-min watermarked, non-downloadable video |
| Starter | $39.99 | 20 | 30 s–2 min, no watermark, B&W only, frame-by-frame prompt edit (1 free) |
| Creator | $99.99 | 60 | +15 s–2 min, multilingual/10 variants, voice instructions, AI presenter |
| Growth | $199.99 | 150 | +15 s–4 min, custom scene selection, color, new sketch styles |
| Business | $499.99 | 390 | +up to 10 min, logo, video instructions, user media, voice cloning, own voice, formal/pen-in-hand, custom canvas styles, podcast, custom music, 10 seats |
| Scale | $999.99 | 800 | +character consistency, API access, priority support, 50 seats |
| Enterprise | custom | custom | 15-min videos, white-glove |

Annual discounts: 40% (Starter/Creator/Growth), 50% (Business/Scale).
Pay-as-you-go: 5–19 credits $7.99 ea; 20–99 $5.99; 100+ $3.99.
Add-ons seen in bundles/pricing: credits, multilingual ($40), logo upload ($100), video instruction ($100), 8 & 10 min videos ($200), 15 min ($200), API ($200).
Credit ledger flags on the user row: `watermark_add_on`, `lang_add_on`, `script_add_on`, `video_instruction_add_on`, `logo_add_on`, `team_add_on`, `api_add_on`, `longer_videos_add_on`.
Billing via Stripe (live publishable key `pk_live_51PgE9v…`), flows: create-stripe-session, plan-upgrade checkout/complete, annual-upgrade options/checkout, customer portal, cancel/pause/resume, remove-addon.

---

## 9. Data model (Supabase)

Client-visible PostgREST reads:

- `user_credits` select: `credits, plan, email, name, user_id, stripe_email, next_subscription_date, custom_logo_url, subscription_canceled, created_at, generation_preferences, experiment_assignment, watermark_add_on, lang_add_on, script_add_on, video_instruction_add_on, logo_add_on, team_add_on, api_add_on, longer_videos_add_on`
- `system_status` select `force_show, force_hide, auto_detect_enabled, title, message, severity` (public maintenance/status banner)
- `organizations`, `api_key`, `admin_users`

RPCs called from the client: `get_user_admin_role`, `get_user_admin_permissions`, `is_blog_admin`, `add_blog_admin`, `remove_blog_admin`, `update_admin_permissions`.

Videos, playlists, characters, voice clones and custom music come through the BFF (`/api/...`), not directly from PostgREST.

---

## 10. Third-party and infrastructure inventory (observed at runtime)

| Purpose | Endpoint / ID |
|---|---|
| Tag manager | GTM `GTM-5KJJQMNH`; server-side container `server-side-tagging-vpapryno5a-uc.a.run.app` |
| GA4 | `G-3YE5K03T6L`, `G-K9FMWZ61GD` |
| Ads | Google Ads `17544981754`, TikTok pixel `D6PO16JC77U06JA6IT30`, Meta pixel `1667971814630816` + CAPI `mpc2-prod-26-is5qnl632q-uc.a.run.app` |
| Product analytics | PostHog `us.i.posthog.com` / `us-assets.i.posthog.com`, project `phc_if4No7bKWvMi6o242QGr7KEFo1jEANuVeXCtloI48KK` |
| OpenAI Ads | `bzrcdn.openai.com/sdk/oaiq.min.js`, pixel `2NfqyBESbHkjb7gJmqt48i`, events to `bzr.openai.com` |
| Payments | Stripe.js (basil API, 2025-03-31) |
| Fonts | Fontshare (Satoshi), Google Fonts |
| Media CDN | `golpo-media.s3.amazonaws.com` (+ us-east-2), `golpo-podcast-inputs`, `golpo-dev-private` |
| Misc | `r.wdfl.co/rw.js`, `capi-automation.s3.us-east-2.amazonaws.com` |
| Cookies | `_ga`, `_ga_*`, `_gcl_au`, `_fbp`, `_ttp`, `ttcsid*`, `__obref`, `__stripe_mid`, `__stripe_sid`, `ph_phc_*_posthog` |

Sentry, Amplitude, Segment, Crisp, HubSpot and Clarity strings exist in bundles but were **not** observed making requests in these captures (library-only or conditionally loaded).

---

## 11. Feature gating (from the live playground UI)

- Own Narration: disabled → "Upgrade to Business or above".
- Script Mode: enabled.
- User videos/images + screen recording: "available on Business or above".
- AI Presenter: "Available on Creator and higher"; Audio Only toggle disabled below Business.
- Voice instructions: "Upgrade to Creator or above" to add custom instructions (preview/select still available).
- Edit video: "Upgrade to a subscription plan to edit videos"; "Remove Watermark + Download" upsell on library cards.
- Library filters: type (All/Color/B&W/Podcast), search, Golpo type/style/duration/language/voice/music/orientation, multi-select → playlist, make public, share to X/Facebook/LinkedIn, copy link.

---

## 12. Notable defects and observations

1. **Dead BFF routes**: `/api/get-subscription-details` and `/api/active-subscriptions` return 404 on every playground load, surfacing a console error. Subscription state is instead read straight from `user_credits`.
2. **Credits/plan trust boundary**: `plan`, `credits` and all add-on flags are readable by the browser from `user_credits`, so any UI gating is cosmetic; enforcement must be server-side (not verified from outside).
3. **Client-side redirect gating**: `/playground` is server-rendered for anonymous users before the client redirects, so the route is publicly fetchable.
4. **Service worker**: the GTM server-side container registers a worker on the page, which blocks strict service-worker policies and would matter for any deterministic replay.
5. **Error copy leaks support address** (`support@golpoai.com`) and internal status mapping.
6. **Duplicate analytics stacks**: two GA4 properties, GTM both client- and server-side, Meta pixel + CAPI, TikTok, PostHog, OpenAI Ads — heavy tag surface for a video app.

---

## 13. Unknowns

- Which vendors/models actually render images, video and TTS (no model IDs client-side).
- Backend service topology behind `api.golpoai.com` and the BFF proxies (Next.js route handlers only, no server bundle).
- Supabase RLS policies (only client-visible effects observed).
- Stripe price IDs and webhook handling.
- Internal queue/worker design for `job_id` polling; retry/backoff on the backend.
- MP4/poster URL signing rules for private videos.

---

## 14. Reproduction

```powershell
# static
rea analyze-javascript-application "$env:TEMP\opencode\golpo-re\chunks" `
  --source-path page-1928bc6e48b57a33.js --artifact-format directory `
  --detail summary --evidence_output "$env:TEMP\opencode\golpo-re\evidence-playground-page" `
  --max-heap-mb 2048 --analysis-timeout-ms 180000 --format json

# runtime (connect to an instrumented Chrome on 9222)
rea capture-browser-scenario "$env:TEMP\opencode\golpo-re\scenario-playground.json" --format json
```

Scenario used (`scenario-playground.json`): connect mode, `start_url` `/playground`, one `wait_for_timeout`, `events: ["network","console","page-errors"]`, `network: {request_body, response_body, header_values}`, `at_end: ["url","dom","accessibility","storage"]`, plus `environment.service_workers: "allow"` (required).

---

## 15. Evidence index

| Evidence | Contents |
|---|---|
| `ev_080c7eb34c8126d68b2cca89aafe3bbede459f398c1330ae92f37df527723aff` | Static analysis of playground bundle (1,732 findings, 11 modules, 146,201 AST nodes) |
| `ev_7eb1ae47ff04ea9014e6c5d030179239b1e54aa54b2cf176bdfe0d6402cdd86b` | CDP target discovery |
| `ev_4f3eb1c3c11da19cae15ce44d27f9e257bac37e3b68253f38edb878c1c61fa5a`, `ev_32929e532e630f4106a476f88a105ffb1610cb21f011b5e6b252891d706b0153` | Passive logged-out inspection |
| `ev_8566a0b730f202290ade36d2cb0b421b4cec2be79513983296b955b7c263e243` | Logged-out navigation: `/playground` → `/`, 147 requests |
| `ev_c927cca25860103d30c48a8eaae24ebe47d5830d78d67f06f46bbfa97427e200` | Logged-out landing accessibility tree |
| `ev_e4cedf1e7339e7fd1bfbb5b5fedb158c841756754f410142d489a0f3e56b156f` | Sign-in modal (Google / Microsoft) |
| `ev_29b599615a08fcd7ca0eec84910c746f382c6b0e0f9dd8c55760a25e01b59773` | Logged-in playground startup calls |
| `ev_c8b30c36c7ac364d9431941ad9a28d4590df1973b8afe1f301368665aff92727` | Response schemas (characters, styles, voices, music, orgs, avatars, changelogs, user_credits) |
| `ev_c186b94363812b6c2f88df0be6a82e268ba710c5b5a1a3b536ce52b48b15c8b0` | Request header names + playground accessibility tree |
| `ev_1c6632d2d3254bfa1a43bc57fc1febe7388f8d82f0ecad7440e19a2fa2ad4995` | Library page (`/library`) and its filters |
