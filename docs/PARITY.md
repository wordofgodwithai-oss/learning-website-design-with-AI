# Parity audit

Checked against `REPORT.md` on 10 November 2026. The goal is behavioural parity with
golpo.ai using free/no-key providers, not byte-identical output: the production render
vendor, voice catalogue and private service keys are not observable.

## How this was verified

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `node scripts/smoke.mjs` | **34/34 checks pass** |
| Auth (local mode) | Sign-in, token, session cookie, session lookup |
| Dashboard boot | 11/11 startup BFF calls |
| Generation | 30 s video, script, scenes, MP4, JPEG poster, byte ranges |
| Language variants | 2 translated videos rendered from one request |
| Public API | v1 multipart, v1 status/list, v2 JSON |
| MCP | `tools/list` returns 6 tools; `tools/call generate_video` works |
| Rejections | Unauthenticated BFF → 401; invalid API key → 401 |
| PDF import | 200, 12 words extracted from a real PDF |
| DOCX import | 200, 11 words extracted from a real OOXML package |
| v2 field mapping | engine, style variant, `pen_animation_style`, `image_generation_model`, characters and `style_reference` preserved in the video row |
| `fill_in` | 13-word pasted script expanded to 69 words for a 30 s target |
| Restart recovery | Background worker swept 6 abandoned jobs and resumed queued work |

## Implemented in this pass

| Capability | Behaviour |
| --- | --- |
| Background job worker | Advances jobs without a polling browser; resumes queued work after a restart; fails jobs older than `GOLPO_JOB_STALE_MS` |
| Render ownership | DB token + process-global set prevent duplicate/parallel renders of the same job |
| DB writes | Process-global queue and unique temp filenames survive dev hot reloads |
| PDF/DOCX import | Local `unpdf` / `mammoth`, no document leaves the machine |
| `characters` | Saved ids, `{id}` objects and inline `{name, description}` resolve into artwork prompts (up to 8) |
| `pen_animation_style` | `fast` (0.55×), default (1×), `slow` (1.6×), `none` (no wipe); no longer confused with the sketch style variant |
| `image_generation_model` | Mapped to Pollinations `flux` (default) or `turbo`; Cloudflare uses its configured FLUX model |
| `fill_in` | Keeps the pasted script, expands it to the runtime word budget with Groq; falls back to trimming if Groq fails |
| `media_file_use_as_is` | `false` keeps an upload as a reference only and illustrates the scene; default `true` preserves the prior use-as-artwork behaviour |
| Playground UI | Orientation, saved-character selection and fill-in toggle added |

## Known gaps and remediation

| Gap | Current behaviour | Recommended fix |
| --- | --- | --- |
| `style_reference` | Stored on the video row but not used to condition artwork: free providers are text-to-image only | Add an img2img endpoint (Cloudflare SDXL/FLUX Kontext) or extract a palette with `sharp` and tint the theme |
| `customScenePreparationId`, `customSceneSelectionSentences` | Accepted and preserved, not applied | Would need the production scene planner; out of reach without its service contract |
| `characterConsistencyMode` | Characters now appear in prompts; no per-mode seed locking | Add deterministic per-character seeds or reference-image conditioning |
| `user_video_avatar_modes`, `user_audio_in_video` | PiP/full-screen narration works; per-mode crop and audio mixing are partial | Add crop offsets and an FFmpeg mix for uploaded audio over narration |
| Voice clones | Clones are stored and listed, but TTS uses Orpheus/Edge voices | Needs a cloning provider (paid); no free equivalent |
| `is_edit` | Regeneration exists, but the edit contract is not implemented | Requires the production edit payload; `POST /api/regenerate` covers the common retry case |
| Organization credits | Mock billing is shared/unlimited; org pools are derived from the user balance | Add an org ledger if real per-seat billing is needed |
| Playground controls | Style reference, logo upload, custom styles and voice-clone management are API-only | Surface the existing routes in the UI |

## Quality caveats

1. **Narration** prefers Groq Orpheus. The free tier (3,600 tokens/day) regularly returns 429,
   so most renders fall back to Microsoft Edge voices. Both are natural; timbre differs from
   production.
2. **Artwork** uses Cloudflare FLUX when configured, otherwise Pollinations (~46 s/image
   throttle). Renders of long videos therefore take minutes. The vector doodle fallback keeps a
   failed provider from failing the job.
3. **Duration** is enforced after narration is measured: silence tightening → `atempo` 0.9–1.25×
   → residual spread across scenes. A 30 s request produces a ~30 s MP4.
4. **PDF/DOCX** handle selectable text only; scanned pages need OCR and return 422.
