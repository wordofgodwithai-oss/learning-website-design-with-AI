# Forensic comparison — golpoai.com vs golpo-local

Date: 10–13 November 2026
Scope: the live production product (`https://video.golpoai.com`) versus this repository.
Method: live site crawl + read-only signed-in audit of the real create page, library
and modals + real render sampling (including one render from the audited account) +
source comparison.

Evidence is stored under `docs/forensics/`:

| Path | Contents |
| --- | --- |
| `docs/forensics/api-v2.txt` | Full `POST /api/v2/videos/generate` parameter table, defaults and validation rules |
| `docs/forensics/api-v1.txt` | v1 (multipart) contract |
| `docs/forensics/guides/*.txt` | 30 product guides (complete tutorial, styles, editing, avatars, narration, credits) |
| `docs/forensics/pricing.html` | Live plan matrix |
| `docs/forensics/gallery.html` | The 31 public gallery style categories |
| `docs/forensics/samples/*.mp4` | Eight real Golpo renders |
| `docs/forensics/samples/sheet-*.jpg` | Frame contact sheets used below |
| `docs/forensics/live/audit-notes.txt` | Verbatim signed-in UI capture: every control, option list, gate and copy string |
| `docs/forensics/live/playground-form.html` | Live create-form DOM snapshot (gitignored) |
| `docs/forensics/samples/real-account-1min.mp4` | This account's own render, downloaded through the signed-in player |
| `docs/forensics/samples/sheet-real-account.jpg` | Contact sheet for the above |
| `docs/forensics/samples/sheet-local-2026-11-13.jpg` | Contact sheet of the clone's own 60 s render, measured in §9.9 |

> Domain note: `golpo.ai` is now a parked Namecheap domain. The product lives at
> **`video.golpoai.com`** (app) and **`api.golpoai.com`** (API). Any older note that
> treated `golpo.ai` as the target is stale.

---

## 1. Headline finding

The local clone produces a **narrated slide deck**. The real product produces a
**hand-drawn, progressively-built whiteboard animation**.

| | Real Golpo | golpo-local |
| --- | --- | --- |
| Frame content | 4–10 hand-drawn elements per scene, arrows, labels, diagrams | One generated image + a paragraph of narration text |
| Drawing | A photographic hand with pen/marker/stylus draws each element | A single clip-path wipe reveals a finished image |
| Text on screen | Short labels and headings, hand-lettered | The full narration sentence, typeset |
| Chrome | None | `GOLPO · CANVAS` header, `1/13` scene counter, style/language/duration footer, chapter badge, progress bar |
| Artwork | Purpose-built whiteboard line art | Abstract AI art with a visible `© pollinations.ai` watermark |
| Scene cadence | Continuous motion; scenes advance with narration | Each scene frozen for up to ~20 s |
| Duration honesty | Script is sized to the requested runtime | A 300 s request shipped 45 s of speech padded with 255 s of stills |

The last row is the single biggest visible defect and is reproducible:

```
[render] vid_ebba… narration: 118 words in 36.1s
[render] vid_ebba… narration ran 45.2s; spreading 254.8s across 13 scenes
```

A 5-minute request produced a script of 118 words (target ≈ 750) and the renderer
then stretched each scene to ~20 s to reach 300 s.

---

## 2. Root causes in the local pipeline

### P0-1 — The fallback script writer ignores the duration budget

`src/lib/generation/script.ts` → `buildScript()`

The template writer assembles sentences from fixed pools and loops them to fill
scenes. It emits ~118 words regardless of whether the target is 30 s or 300 s, and
it repeats the same four sentences verbatim (visible in the rendered output as
identical consecutive scenes).

`targetWordCount()` already computes the correct budget (~2.4 words/s → 720 words
for 300 s). `buildScript()` never enforces it.

**Change:** make `buildScript()` budget-driven — pick sentences until the budget is
met, drawing on prompt-derived topic sentences plus varied explanatory templates;
assert `countWords(script) >= 0.8 * targetWordCount(duration)` and extend rather
than truncate. Never allow the same sentence twice.

### P0-2 — Duration fitting pads with frozen frames

`src/lib/media/render.ts` → residual spread after `atempo`

The current order is: tighten silence → `atempo` 0.9–1.25× → spread the remainder
across scenes. The spread has no per-scene cap, so a short script becomes a long
static video.

**Change:** cap the residual spread at ~1.0 s per scene. If narration still covers
less than ~70 % of the requested duration, re-run script generation with the
missing word count instead of padding. Better a 60 s honest video than a 300 s
frozen one — but the goal is to hit the target.

### P0-3 — The scene layout is a slide, not a whiteboard composition

`src/lib/media/svg.ts`

Every scene renders: header row, narration paragraph, one framed artwork panel,
chapter badge, footer meta. Real Golpo renders **elements** — headings, labelled
diagrams, arrows, icons, callouts — placed across an empty canvas and drawn over
time, with the narration heard, not printed.

**Change:** rebuild the frame compositor around a component list per scene
(`{kind: heading|label|diagram|icon|arrow|image, text, box, drawOrder}`). Keep the
narration out of the frame. Add a drawing/reveal animation per component (stroke
reveal for line work, scale-in for icons, wipe for images).

### P0-4 — No pen-in-hand animation

Real `pen_animation_style` (`stylus` / `marker` / `pen`) puts a photographic hand
holding that tool on the canvas, moving along the stroke being drawn. The local
implementation treats the field as a *speed* multiplier and has no hand asset.

**Change:** revert the speed interpretation (it was introduced in this repository
by mistake — see §3), ship three hand+tool overlays (PNG sequences or sprite
sheets), and drive hand position from the reveal path of each component.

### P0-5 — Artwork quality and a third-party watermark

`src/lib/media/artwork.ts`

- Pollinations returns images with `© pollinations.ai` burned in; `nologo=true` is
  not reliably honoured. Every scene in `sheet-local-mid.jpg` carries it.
- The prompt asks for "flat vector illustration", producing abstract art rather
  than whiteboard line work.

**Change:** post-process the returned image to crop/strip the watermark band, or
switch to Cloudflare Workers AI as the primary provider; rewrite prompts to demand
black-ink whiteboard line art with explicit element lists; reject any image whose
bottom-right region correlates with the watermark.

### P0-6 — Palette mismatch

`src/lib/media/theme.ts`

`chalkboard_black_on_white` maps to a beige background (`#f7f4ec`), while the real
style is **white background, black ink**. `chalkboard_white` uses a mint accent
instead of chalk white on near-black.

**Change:** align the eight shared palettes to the real screenshots (white, black,
chalk white, chalk colour accents). Remove the invented `neon`, `marker`, `vox`
names — see §4.

---

## 3. API contract deltas

Source of truth: `docs/forensics/api-v2.txt` (the vendor's live reference).

### 3.1 Fields that are wrong today

| Field | Real semantics | Local behaviour | Severity |
| --- | --- | --- | --- |
| `pen_animation_style` | `stylus` \| `marker` \| `pen` — Canvas only, Scale plan+ | Treated as a **speed** (`fast`/`slow`/`none`) multiplier | **Critical** — a valid request is misread and a made-up value changes timing |
| `video_orientation` | `horizontal` \| `vertical` only | Accepts `16:9` \| `9:16` \| `1:1` | High — `1:1` does not exist; real values are rejected |
| `timing` | String minutes: `0.25, 0.5, 1, 2, 4, 8, 10, 15, auto` | Parsed but duration uses `durationSeconds`; no `auto` | High |
| `narration_voice` | `female-1…7`, `male-1…7` (14 voices), default `female-1` | 8 invented names (`Ava`, `Noah`, …) | High |
| `narration_instructions` | Free text describing delivery | Only `voice_instructions` is read | Medium |
| `scene_pacing` | `normal` (15 s/scene) \| `fast` (10 s/scene) | `normal`/`fast` accepted, no scene cap applied | Medium |

### 3.2 Fields that are missing entirely

Confirmed absent from `src/lib/generation/request.ts`:

| Field | What it does | Impact |
| --- | --- | --- |
| `visual_instructions` | Steers the look ("more graphs", "no text", fonts) | Every video looks the same regardless of guidance |
| `onscreen_text_from_script_only` | Restricts on-screen words to script source | Text accuracy / compliance |
| `visual_animation_style` | `auto` \| `fade_in` \| `sketch` for Canvas components | No component animation |
| `frame_transition` | `none,left,right,up,down,zoom_in,zoom_out` (array) | No scene transitions |
| `transition_hand_animation` | Animated hand pushes each slide | Missing |
| `custom_style` | id from `/api/v2/custom-styles` | Custom Style unusable |
| `avatar_id`, `avatar_layout`, `avatar_position`, `avatar_split_size`, `avatar_framing`, `custom_videos_avatar_modes` | AI Presenter system | Only an image-based stand-in exists |
| `reference_source` | Document URLs for the script | Only multipart uploads work |
| `reference_images` | Problem-solving mode (math/science) | Missing |
| `keep_original_images`, `disable_image_animation` | Per-image behaviour | Missing |
| `use_ai_audio_at` | 1-indexed video positions to re-voice | Local `user_audio_in_video` uses a different shape |
| `own_narration_video_layout` | `round_overlay` \| `side_by_side` | Only `pip_position`/`video_mode` aliases |
| `own_narration_video_fit`, `own_narration_focus_position` | Crop behaviour, 0–100 framing | Missing |
| `language_variants` name | Real field is `language_variants`; local uses `variant_languages` | API incompatibility |
| `variant_visuals_mode` | `shared` \| `per_language` | Missing |
| `visibility` PATCH | `PATCH /api/v2/videos/{id}` accepts only title + visibility | Broader local patch |

### 3.3 Endpoints missing

Real surface (base `https://api.golpoai.com`):

```
GET    /api/v2/videos
GET    /api/v2/videos/{video_id}
PATCH  /api/v2/videos/{video_id}        title + visibility only
DELETE /api/v2/videos/{video_id}
GET    /api/v2/videos/status/{job_id}
GET    /api/v2/users/credits
POST   /api/v2/videos/upload-file       15 MB cap (docs say <10 MB in one place), presigned
POST   /api/v2/custom-styles
GET    /api/v2/custom-styles
GET/PATCH/DELETE /api/v2/custom-styles/{id}
GET    /api/v2/avatars/stock
GET    /api/v2/avatars
POST   /api/v2/avatars
POST   /api/v2/avatars/upload
POST   /api/v2/avatars/upload-url
POST   /api/v2/avatars/layout-preview
GET    /api/v2/avatars/{id}
PUT    /api/v2/avatars/{id}
DELETE /api/v2/avatars/{id}
GET    /api/v2/avatars/{id}/layout-previews
PUT    /api/v2/avatars/{id}/layout-config
POST   /api/v2/avatars/{id}/video-preflight
POST   /api/v2/avatars/{id}/edit
POST   /api/v2/avatars/{id}/retry
POST   /api/v2/avatars/{id}/approve
```

Local equivalents for avatars exist as BFF-style routes (`/api/avatars`,
`/api/stock-avatars`) but not under the v2 namespace, and `/api/v2/users/credits`,
the custom-style `{id}` routes and the whole preflight/approval flow are absent.

### 3.4 Validation rules the local API does not enforce

- `canvas_style_variant` is **required** when the engine is `golpo_canvas`; `null` → 422.
- `sketch_style_variant` is **required** when the engine is `golpo_sketch`.
- `custom_images_description` must have the same length as `custom_images`.
- `logo_position` without `watermark`/`custom_logo` → 422.
- `pen_animation_style` with `golpo_sketch` → 422.
- `onscreen_text_language` with `golpo_sketch` → 422.
- `frame_transition` other than `["none"]` with `scene_pacing: "fast"` → 422.
- `transition_hand_animation` with `zoom_in`/`zoom_out` → 422.
- `custom_style` with `enable_podcast_engine` → 422.
- Duplicate language in `language_variants` (incl. primary) → 400.
- `custom_script` longer than ~15 minutes → 422.

---

## 4. Catalogue deltas

### 4.1 Engines and styles

Real dashboard/gallery vocabulary:

**Golpo Canvas** (11 styles, ten with `_compact` profiles):
`chalkboard_bw`, `chalkboard_black_on_white`, `chalkboard_color`, `whiteboard`,
`modern_minimal`, `playful`, `technical`, `editorial`, `sharpie`, `illustrations`,
`notebook_infographic`.

**Golpo Sketch**:
`classic`, `classic with words`, `improved(beta)`, `formal`, `formal_legacy`,
`crayon`, `dry_erase`, `professional_clean`, `creative`, `infographics`,
`chalkboard_black_on_white`, `custom`.

**Golpo Studio** (11, added after the first pass — see §9.2):
Colorful Sketch, Khan Academy, Chalkboard, Bold Marker, Simple Sketch, Marker
Cartoon, Brightboard, Neon Blackboard, Notebook, Expressive Editorial Marker,
Signature Whiteboard. Billed at 2 credits/min, Growth+.

Local `theme.ts` has: `chalkboard_white`, `chalkboard_black_on_white`,
`whiteboard`, `playful`, `technical`, `editorial`, `classic`,
`professional clean`, `crayon`, `infographics`, `creative` + legacy aliases
(`neon`, `marker`, `vox`). Missing: `chalkboard_color`, `modern_minimal`,
`sharpie`, `illustrations`, `notebook_infographic`, `improved(beta)`, `formal`,
`classic_with_words`, and the entire Compact/Expanded concept.

### 4.2 Voices, music, durations, languages

| Item | Real | Local |
| --- | --- | --- |
| Voices | `female-1…7`, `male-1…7`; default Female 1; previewable | 8 invented names |
| Music | 7 genres: jazz, lofi, dramatic, engaging, hyper, inspirational, documentary (Canvas/Sketch); Studio adds `auto` and `none` | no genre list; custom upload only |
| Durations | 0.25, 0.5, 1, 2, 4, 8, 10, 15 min (+30/60 beta), `auto`; `auto` unavailable with Script Mode | 15–300 s slider, step 15 |
| Script budget | 1,050 chars/min of the selected duration (Script Mode); 18,500-char ceiling in prompt mode | none — writer ignores duration |
| Orientation | horizontal, vertical | 16:9, 9:16, 1:1 |
| Languages | 46 listed | 48 (close; missing Cantonese, Afrikaans, Swiss German) |

### 4.3 Credit model

Real: **1 credit = 60 s of Canvas/Sketch, 30 s of Studio**; audio-only costs 10 %;
language variants are billed per render; Golpo avatars 3 credits/min, custom 5.

Local: flat mock balance with unlimited override. Fine for a clone, but the cost
display and the per-feature gates should mirror the real ratios.

---

## 5. Playground / dashboard deltas

Real create-video page (from the vendor's own walkthrough capture):

| Area | Real | Local |
| --- | --- | --- |
| Top bar | Instructions **plan-feature explorer**, Credits, Plan, Voice Clone, Library, Upgrade, Profile menu (Voice Clone, Edit Video, Playlist, Sign Out) | credits pill + account only |
| Input | Prompt Content textarea (18,500-char ceiling) + Script Mode (1,050 chars/min of duration), Attach (PDF/DOCX/PNG/JPEG/WebP, one file, ≤10 MB) | prompt + attach |
| Toggles | **Own Narration** (locked), **Script Mode**, **Edit script** (checkbox), **Custom scenes** (Growth+), **Fill Color Gaps** | script-only + fill-in |
| Engines | Three cards — Canvas, Studio (NEW), Sketch — each with **Preview**; the control set changes per engine | plain select |
| Media | User videos/images (beta), Record screen (with audio) | uploads, no screen recording |
| Audio only | Checkbox, 10 % credits | kind=podcast |
| Narration | Voice dropdown with **Listen preview** (Conversational + Female/Male 1–7), Voice Instructions, Language, Display Language (Canvas/Studio only) | voice select, no preview, no display language |
| Visual | Video Instructions, Color, style control named per engine, Pacing with Preview, Pen-in-hand | style select, colour toggle |
| Settings row | Music (with Listen), Duration, Voice, Orientation, Language, Style, Frame transition | inline selects |
| Branding | Logo upload + TL/BL/TR/BR | watermark toggle only |
| Generate | Estimate ("10 min – 15 min"), gallery-visibility opt-in modal, email on completion | no estimate, no opt-in, no email |
| Advanced | per-row Expand for extended settings | none |

### Library

Real: `Videos from` (me/team), Organization, filter tabs (All/Color/B&W/Podcast),
search over prompts/titles/scripts, dropdown filters by engine/style/duration/
language/voice/music, **version history ("Version 9/9")**, aspect-ratio converter,
`User-provided audio narration` badge, Generating state with ETA, Play/Edit/
Download/Settings/Delete, social sharing (X, Facebook, LinkedIn, copy link),
click-through transcript.

Local: thumbnail grid with search/filter/delete/visibility/playlists. No versions,
no transcript, no aspect conversion, no share, no edit.

---

## 6. Missing product surfaces

### 6.1 Editor (largest functional gap)

Two modes, visible in `sheet-component.jpg`:

- **Frame mode** — step through frames, select a component box, edit its
  description, animation type ("Sketch Left to Right"), or write an edit prompt
  ("remove the cross in entertaining"), then *Apply Changes*.
- **Video mode** — same over a timeline, plus a synchronised transcript where the
  spoken word is highlighted as it plays.

Also: add/replace images and text, upload reference images (Sketch only), audio
editing, version compare, first edited version free then billed by length.

Local has none of this; `POST /api/regenerate` is the only recovery path.

### 6.2 AI Presenter (avatars)

Real: 20 Golpo avatars, custom avatars from a portrait with Natural/Polished
pipeline, layouts (`side_by_side`, `round_overlay`, `fullscreen`), positions,
split sizes 25–50 %, framing focus, per-clip avatar modes, preflight checks,
approval/retry/edit lifecycle, 3 or 5 credits/min.

Local: `avatar_image_url` / `avatar_renderer` stand-in, no lip-sync.

### 6.3 Custom Style

Real: `POST /api/v2/custom-styles` from an image URL, a video URL or a text
description; reusable id; works for Canvas and Sketch; Business+.

Local: `/api/v2/custom-styles` stores records but does not condition rendering.

### 6.4 Others

- Voice cloning (Business+), with clone management UI.
- Instructions presets (saved reusable prompt/instruction sets).
- Community gallery visibility toggle + public gallery page.
- API dashboard (`/api-dashboard`), SDKs (Python/Node), MCP (6 tools, `uvx golpo-mcp`).
- Screen recording capture.
- Podcast output surfaced as `podcast_url`.

---

## 7. What the local clone does well (keep)

- Auth modes, mock billing, full BFF surface and route naming.
- Background worker, stale-job sweep, render token ownership.
- PDF/DOCX extraction, language variants pipeline, variant rendering.
- Request normalisation and alias tolerance — extend it, do not replace it.
- Smoke suite (34 checks) and honest documentation.

---

## 8. Remediation order

**P0 — make the output look like Golpo (no new API surface)**

1. Budget-driven `buildScript()`; hard minimum 80 % of target words.
2. Cap residual spread at ~1 s/scene; regenerate instead of padding.
3. Replace the slide layout with a component-based canvas composition.
4. Add pen/marker/stylus hand animation (`pen_animation_style` back to tool type).
5. Artwork: whiteboard line-art prompts, Cloudflare first, strip/deny the
   Pollinations watermark, reject watermarked images.
6. Correct the eight shared palettes to real colours; remove the debug chrome
   (header, scene counter, footer meta, chapter badge, progress bar).

**P1 — contract correctness**

7. Add the fourteen missing request fields and the validation table in §3.4.
8. Rename `variant_languages` → `language_variants`; support `timing` values and
   `auto`; constrain orientation to horizontal/vertical.
9. Replace invented voice names with `female-1…7` / `male-1…7` and map them to
   Orpheus/Edge voices internally.
10. Add `/api/v2/users/credits`, custom-style `{id}` routes, avatar v2 routes,
    `reference_source`, `reference_images`, `use_ai_audio_at`.

**P2 — product UI parity**

11. Playground: Instructions presets, Script Mode + Edit-script-first, Voice
    Instructions, Video Instructions, Display Language, Music genres with preview,
    voice preview, logo upload with placement, generation estimate, visibility
    opt-in.
12. Library: filter tabs + dropdowns, version history, transcript view, aspect
    converter, share links, edit entry point.

**P3 — heavy features**

13. Frame/component editor with transcript sync and versioning.
14. AI Presenter (stock catalogue + custom avatar pipeline + preflight).
15. Custom Style conditioning, voice cloning, screen recording, gallery page,
    API dashboard, SDK/MCP parity.

---

## 9. Live signed-in audit (11 November 2026)

The account used was **Word of God AI / wordofgodwithai@gmail.com**, Free plan,
**0.000 credits**, with a "⚠️ No Credits" banner. Nothing could be generated, so
this section is a read-only capture of the real create page, library, menus and
modals. Verbatim transcript: `docs/forensics/live/audit-notes.txt`.

### 9.1 The control surface is not fixed — it changes with the engine

This is the most important structural finding, and the earlier reconstruction
missed it. Three engine cards (Canvas, Studio, Sketch) each swap the settings
panel for a different set of controls:

| Control | Sketch (default) | Canvas | Studio |
| --- | --- | --- | --- |
| Background music | `Select an option` | `Select an option` | `None` |
| Duration | 1 min | 1 min | 1 min |
| Display language | — | English | English |
| Voice | Female 1 | Female 1 | Female 1 |
| Orientation | Horizontal | Horizontal | Horizontal |
| Frame transition | **disabled** | **enabled** | — |
| Pacing | Fast | Normal | — |
| Video style | `Creative` | — | — |
| Canvas style | — | `Sharpie` | — |
| Studio style | — | — | `Neon Blackboard` |
| Pen in hand | — | None | None |

So `frame_transition`, `scene_pacing` and the style field are **engine-dependent
controls**, not global settings. A clone that renders one settings panel for all
engines is visibly wrong before a single frame is drawn.

### 9.2 Three separate 11-style catalogues

The earlier study recorded Canvas and Sketch only; the live app ships a third,
Studio catalogue. Exact lists are in §4 of the notes; the merged consequence is:

| Engine | Presets | Notes |
| --- | --- | --- |
| Sketch | Classic, Classic (with words), Chalkboard (Black on White), Improved, Dry Erase, Professional Clean, Crayon, Infographics, Creative, Formal, Formal (Legacy) | each has a `- B&W` / `- Color` presentation name in the preview modal |
| Canvas | Chalkboard (White on Black), Chalkboard (Black on White), Chalkboard Color, Whiteboard, Modern Minimal, Playful, Technical, Editorial, Sharpie, Illustration, Notebook | all but Notebook have **Compact / Expanded** |
| Studio | Colorful Sketch, Khan Academy, Chalkboard, Bold Marker, Simple Sketch, Marker Cartoon, Brightboard, Neon Blackboard, Notebook, Expressive Editorial Marker, Signature Whiteboard | 2 credits/min |

Pen in hand is confirmed as a **tool**, not a speed: `None · Stylus · Marker · Pen`
(all but None are Business+). This settles the `pen_animation_style` revert.

### 9.3 Script length is a first-class, duration-derived budget

Independent of the API, the UI enforces the budget that the local writer ignores:

- **Prompt mode** — a fixed ceiling of **18,500 characters**.
- **Script mode** — the counter becomes `1050 × duration minutes`, with the note
  *"Character limit based on 1 min duration (1050 chars/min)"*.
- Turning Script Mode on also **disables `Auto` duration**, because there is no
  runtime to budget against.

This is the number the local pipeline should have been generating to all along:
1,050 chars/min ≈ 170 words/min. A 5-minute request is therefore ~5,250
characters, not the 118 words the local writer currently emits.

### 9.4 The real account's own render

Downloaded through the signed-in player (2,835,482 bytes):

| Property | Value |
| --- | --- |
| Video | H.264, **1536×864**, 30 fps, 250 kbps |
| Audio | AAC, 24 kHz, mono, 69.3 kbps |
| Duration | **69.60 s** for a `1 min` request |
| Visual | full-colour hand-drawn illustration, elements accumulate, arrows and hand-lettered labels |
| On-screen text | short phrases only ("You don't.", "What exactly is investing?", "$1,000", "growth isn't guaranteed", "Let's start with stocks.") |
| Chrome | **none** — no header, counter, footer, chapter badge, progress bar or watermark |

Two calibration points follow. First, "1 min" is a target, not a clamp: the real
product overshoots to ~70 s rather than padding or truncating, so the local goal
should be a motion-filled runtime within roughly ±20 %, never a frozen one.
Second, the frame is *illustration plus accumulating elements plus short
hand-lettered text* — which is exactly what `sheet-real-account.jpg` shows and
what `sheet-local-mid.jpg` does not.

### 9.5 Library and account surfaces (as shipped)

- `/library?tab=videos` — `Videos | Playlists`, `Select`, filter chips
  `All · Color · B&W · Podcast`, then seven dropdowns (type, style, duration,
  language, voice, music, orientation) and `Reset`.
- Video card: prompt excerpt, date, language, duration, voice, `Play`,
  `Remove Watermark + Download`, `Create More Videos`, aspect badge `16:9`.
- `/library?tab=playlists` — empty state with `Create Your First Playlist`.
- Profile menu is exactly `Voice Clone · Edit Video · Playlist · Sign Out`.
  `Edit Video` and `Playlist` are just library tab links; `Voice Clone` is a
  silent no-op on Free.
- The "Instructions" pill is **not** a saved-prompt preset menu — it opens a
  plan-tier feature explorer (Starter → Scale). §6.4's "Instructions presets"
  entry was wrong.
- `api.golpoai.com/dashboard` returns `403 {"message":"Forbidden"}` and
  `/api-dashboard` does not resolve, so there is no API console to mirror for a
  Free account.

The Upgrade-Your-Plan modal (triggered by *Add Character* and *Custom scenes*)
yielded the full price/credit matrix verbatim, including per-tier limits and
add-ons — recorded in the notes file and usable to make the local mock billing
match the real ratios rather than inventing them.

### 9.6 Corrections to earlier sections

- §5: the prompt counter is **18,500** in prompt mode, not 11,000; Script Mode
  adds the 1,050/min budget. The top bar has no saved "Instructions presets".
- §6.4: "Instructions presets" is a plan explorer, not reusable instruction sets.
- §4.2: there are **three** music lists, not one — Sketch/Canvas share the 7
  presets, Studio adds `Auto` and `None` for 9.
- §4.1: add the Studio catalogue; Canvas's `Notebook` is Compact-only; "Formal
  (Legacy)" is a visible preset name.

### 9.7 What this adds to the remediation order

The P0 list in §8 stands. Two items should be promoted because the live audit
proves they are the visible gap:

1. **Script budget first.** Adopt the real rule — 1,050 chars/min of the selected
   duration — in `buildScript()`, and show the same live counter in the UI. This
   alone removes the frozen-frame failure mode.
2. **Engine-specific control matrix.** `frame_transition` and `scene_pacing` must
   be enabled/disabled per engine exactly as in §9.1, and the style menu must be
   the correct one of the three catalogues.

Then continue with §8 as written: component-based canvas composition, pen-in-hand
tool overlays, watermark-free line art, palette correction, chrome removal.

### 9.8 Implementation status

Both promoted items are implemented in the local clone.

| Item | Where | Behaviour now |
| --- | --- | --- |
| Script budget (1,050 chars/min) | `src/lib/generation/script.ts` | `SCRIPT_CHARS_PER_MINUTE = 1050`, `PROMPT_CHAR_LIMIT = 18500`, `scriptBudget(duration)`, `formatMinutes()`. The writer fills the budget without repeating a sentence and splits one scene per sentence (cap 60). Verified budgets: 60 s → 1,050, 240 s → 4,200, 900 s → 15,750 characters, zero duplicate sentences. |
| Live counter + Script Mode | `src/components/Playground.tsx` | Script Mode toggle switches the field to “Script Content”, the counter to `0 / 1050 characters` with the note “Character limit based on 1 min duration (1050 chars/min)”, and disables Auto duration. Prompt mode keeps `0 / 18500 characters`. |
| Engine-specific matrix | `src/lib/generation/config.ts`, `request.ts` | `ENGINE_CAPABILITIES` drives which controls render: frame transition Canvas-only (Sketch shows it disabled with “Available on Golpo Canvas only”, Studio hides it), pacing Canvas+Sketch, display language Canvas+Studio, pen-in-hand Canvas+Studio, Studio music adds None. Validation rejects illegal combinations. |
| Three catalogues | `config.ts`, `media/theme.ts` | Canvas/Sketch/Studio each expose their own 11 presets with real labels; every palette is resolved per style key. |
| Voice + music catalogue | `config.ts`, `ai/edge-tts.ts`, `media/audio.ts` | `conversational` + `female-1…7` / `male-1…7`, mapped internally onto Orpheus/Edge voices. Studio bills 2 credits/min. |

Still open from §8: residual spread capping, component-based canvas composition,
pen-in-hand overlays, watermark-free line art, and chrome removal.

### 9.9 Measured run: the clone's own 60 s render (13 November 2026)

The clone was run end to end and its output measured against the real reference so
the remaining gap is quantified rather than inferred.

**Setup.** Signed-in session on the local app, one request through
`POST /api/generate`:

| Input | Value |
| --- | --- |
| Prompt | "How compound interest makes money grow, explained with a simple example for a beginner." |
| Engine / style | `golpo_sketch` / `classic` |
| Duration / orientation | 60 s / 16:9 |
| Job / video | `job_e95a75de683222f2c63a4972` / `vid_65e52f2aa1fbfaf57894f92e` |
| Modes | `GOLPO_SCRIPT_MODE=local`, `GOLPO_TTS_MODE=edge`, `GOLPO_IMAGE_MODE=off`, `GOLPO_RENDER_MODE=ffmpeg` |
| Result | ready in 96 s wall time, 1,025-char script, 172 words, 12 scenes |

The output was probed with `ffprobe`, sampled into
`docs/forensics/samples/sheet-local-2026-11-13.jpg`, and measured
with three objective filters: scene cuts (`select='gt(scene,0.25)'`), frame-to-frame
difference (`tblend=all_mode=difference` + `signalstats` mean luma), and frozen
segments (`freezedetect`). The real reference
(`docs/forensics/samples/real-account-1min.mp4`) was measured identically.

**Output-level parity**

| Metric | Real reference | Clone | Gap |
| --- | --- | --- | --- |
| Frame size | 1536 × 864 | 1280 × 720 | 1.44× fewer pixels |
| Frame rate | 30 fps | 30 fps | none |
| Video codec / bitrate | H.264 / 250 kbps | H.264 / 121 kbps | half the visual information |
| Duration for a "1 min" request | 69.60 s | 60.06 s | clone clamps, real overshoots |
| Audio | AAC, 24 kHz, mono, 69 kbps | AAC, 44.1 kHz, stereo, 152 kbps | wrong format, 2× bitrate |
| Loudness (mean / peak) | −30.0 dB / −11.0 dB | −23.8 dB / −4.4 dB | clone is ~6 dB hot and over-compressed |
| Total file size | 2.84 MB | 2.11 MB | 26% smaller |

**Motion and composition**

| Metric | Real reference | Clone | Gap |
| --- | --- | --- | --- |
| Hard cuts detected (threshold 0.25) | 3 (4 continuous shots) | 0 | every clone scene shares the same layout, so scene changes are invisible at the frame level |
| Mean frame-to-frame difference | 0.458 | 0.128 | 3.6× less on-screen motion |
| Frozen time (≥ 0.5 s static) | 29.9 s = 43% | 48.9 s = 81% | clone shows a still image for most of every scene |
| Frames per scene | continuous 30 fps motion | 18 PNGs (1.5 s at 12 fps) then a cloned still | `tpad=stop_mode=clone` + `-tune stillimage` |
| Composition | full-bleed white canvas, illustration fills the frame | header, `n / 12` counter, framed art panel, caption paragraph, footer, progress bar | chrome is still shipped in every frame |
| On-screen text | short hand-lettered phrases ("You don't.", "$1,000") | full narration paragraph, wrapped to 7 lines | reads as slide, not whiteboard |

**Artwork**

`GOLPO_IMAGE_MODE=off` means `generateArtwork()` returns nothing and the renderer
falls back to `renderDoodles()` vector icons: one small monochrome glyph per scene
(rocket, graph, clipboard, grid, stick figure), centred in a bordered panel with
large empty margins. That is why the clone's sheet reads as an icon deck while the
real sheet reads as hand-drawn illustration. `useColor: true` does not help:
`golpo_sketch/classic` resolves to `accent: #1f2937`, so even the accent is
near-black.

The keyless colour option was tested: Pollinations still serves FLUX without a key,
but the request with `nologo=true&private=true` came back with a baked-in
`pollinations.ai` watermark in the corner. Cloudflare (the other provider) needs an
account ID and token. So with zero keys the clone can only reach watermark-free line
art, not the reference's full-colour, watermark-free illustration.

**Script and scene plan**

The 1,050-char budget is now respected (1,025 chars), but the writer's sentence and
visual pools repeat: the 12 scene visuals are six descriptions cycled twice, so
scene 1 and scene 7 are both "A character pointing at the first step". Narration is
coherent but generic ("If you have ever felt lost in how compound interest…"), with
no concrete example, number, or named entity — where the real script builds a
specific story around one example.

**What the clone must change, in impact order**

| # | Change | Where | Why it matters | Acceptance test |
| --- | --- | --- | --- | --- |
| 1 | Animate the whole scene, not just the first 1.5 s. Build each scene as a sequence of draw steps (art wipe, then element-by-element add, label writes, small drift) and encode at 30 fps for the full narration length. | `src/lib/media/render.ts` (`encodeArgs`, frame loop), `src/lib/media/svg.ts` (`renderSceneFrame` progress semantics) | Removes 81% frozen time; this is the single largest perceptual gap. | `freezedetect` static time ≤ 50% of runtime; mean frame difference ≥ 0.35 |
| 2 | Remove all chrome from the canvas: header, brand mark, scene counter, footer metadata, progress bar, framed panel, page wash and grain. Leave only the illustration and a short caption. | `svg.ts` (`headerRow`, `footer`, `progressBar`, `panel`, `background`) | Real frames are edge-to-edge illustration on white. | Contact sheet contains no text other than the caption; visual diff shows art occupying ≥ 85% of frame area |
| 3 | Replace the printed narration with a derived 2–6 word caption, rendered in a hand-lettered face in cyan at a slight angle with a marker underline; keep narration audio only. | `svg.ts` (`narrationLayer`, `underline`), `scene.caption` derivation in `src/lib/generation/script.ts` | Real on-screen text is sparse and integrated, never a paragraph. | ≤ 7 words per scene, no sentence punctuation, accent colour `#22d3ee` |
| 4 | Compose the canvas per scene instead of per slide: one full-bleed art area, accumulating elements (previous beats stay on screen), figures and arrows rather than a single centred icon. | `svg.ts` (`composeFrame`, `artworkLayer`), `src/lib/media/illustration.ts` (`renderDoodles` → multi-element scene builder) | Real shots are one canvas that fills in over 12–20 s. | ≤ 1 hard cut per 15 s; ≥ 4 distinct elements accumulate per shot |
| 5 | Get real colour illustration. Either enable a keyed image provider, or accept watermark-free procedural colour and build a richer vector scene library (fills, characters, arrows, labels). | `src/lib/media/artwork.ts`, `src/lib/integrations.ts` (`imageMode`) | Icons + empty panel cannot match hand-drawn colour scenes. | Artwork source = `ai` or `colour-vector`; palette limited to ink + 2 accents |
| 6 | Match the reference's output parameters: 1536 × 864 for 16:9, 24 kHz mono AAC at ~70 kbps, loudness normalised to about −30 dB mean / −11 dB peak, and a runtime within ±20% (allow overshoot rather than clamping). | `src/lib/media/theme.ts` (`ORIENTATION_SIZES`), `render.ts` (`encodeArgs`, `mixFinal`, duration fitting) | Container-level parity; the real player expects 1536 × 864. | `ffprobe` matches the reference table above within 5% |
| 7 | Stop repeating visuals and sentences: make the visual pool at least as large as the scene count, derive each scene's visual from its own sentence, and require one concrete example per script. | `src/lib/generation/script.ts` | Removes the "same six cards twice" rhythm. | Zero duplicate scene visuals for scripts ≤ 60 scenes |

Items 1–4 are fully local and cost no keys; item 5 is the only one blocked by a
provider decision. Item 1 also raises render time (currently 96 s for 60 s because
each scene is 18 frames); 30 fps × 60 s is 1,800 frames, so plan on a few minutes
per render and keep the frame cache.

---

## 10. Limits of this study

- The signed-in dashboard was audited read-only on 11 Nov 2026; the account had
  **0.000 credits**, so no generation could be triggered and the create page could
  not be exercised end to end. Every control, option list, gate and copy string was
  captured, and one pre-existing render was downloaded and probed.
- The render vendor, voice provider and scene planner are private; their output is
  observable, their contracts are not.
- Marketing videos may be edited for the landing page; the frame-level composition
  (hand, accumulation, labels) is nevertheless consistent across seven samples and
  the public gallery categories.
