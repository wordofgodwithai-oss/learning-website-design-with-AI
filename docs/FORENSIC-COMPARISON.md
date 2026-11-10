# Forensic comparison — golpoai.com vs golpo-local

Date: 10 November 2026
Scope: the live production product (`https://video.golpoai.com`) versus this repository.
Method: live site crawl + authenticated-UI capture from the vendor's own walkthrough
recordings + real render sampling + source comparison.

Evidence is stored under `docs/forensics/`:

| Path | Contents |
| --- | --- |
| `docs/forensics/api-v2.txt` | Full `POST /api/v2/videos/generate` parameter table, defaults and validation rules |
| `docs/forensics/api-v1.txt` | v1 (multipart) contract |
| `docs/forensics/guides/*.txt` | 30 product guides (complete tutorial, styles, editing, avatars, narration, credits) |
| `docs/forensics/pricing.html` | Live plan matrix |
| `docs/forensics/gallery.html` | The 31 public gallery style categories |
| `docs/forensics/samples/*.mp4` | Seven real Golpo renders |
| `docs/forensics/samples/sheet-*.jpg` | Frame contact sheets used below |

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
| Music | 7 genres: jazz, lofi, dramatic, engaging, hyper, inspirational, documentary | no genre list; custom upload only |
| Durations | 0.25, 0.5, 1, 2, 4, 8, 10, 15 min, `auto` | 15–300 s slider, step 15 |
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
| Top bar | Instructions presets dropdown, Credits, Plan, Voice Clone, Library, Upgrade, Profile menu (Add-ons, Edit Video, Team, Manage Billing, Sign Out) | credits pill + account only |
| Input | Prompt Content textarea (11 000 char counter), Attach (PDF/DOCX) | prompt + attach |
| Toggles | **Own Narration**, **Script Mode**, plus separate *Edit script before creating video* | script-only + fill-in |
| Engines | Two cards, Canvas and Sketch, each with **Preview** and 2.0 badge | plain select |
| Media | User videos/images (beta), Record screen (with audio) | uploads, no screen recording |
| Audio only | Checkbox, 10 % credits | kind=podcast |
| Narration | Voice dropdown with **Listen preview**, Voice Instructions, Language, Display Language | voice select, no preview, no display language |
| Visual | Video Instructions, Color, Style with Preview, Pacing with Preview, Pen-in-hand | style select, colour toggle |
| Settings row | Music (with Listen), Duration, Voice, Orientation, Language, Style | inline selects |
| Branding | Logo upload + TL/BL/TR/BR | watermark toggle only |
| Generate | Estimate ("2–3 min"), gallery-visibility opt-in modal, email on completion | no estimate, no opt-in, no email |
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

## 9. Limits of this study

- The signed-in dashboard could not be driven: anonymous `/playground` redirects to
  `/` (confirmed twice), so the create-video page was studied from the vendor's own
  walkthrough recordings plus the complete written tutorial and live API reference.
- The render vendor, voice provider and scene planner are private; their output is
  observable, their contracts are not.
- Marketing videos may be edited for the landing page; the frame-level composition
  (hand, accumulation, labels) is nevertheless consistent across seven samples and
  the public gallery categories.
