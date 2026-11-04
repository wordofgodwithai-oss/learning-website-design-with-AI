import { getUserFromRequest } from "@/lib/auth";
import { fail, json, readJson, str } from "@/lib/http";
import { createVideoRecord, newVideoId } from "@/lib/repo";
import type { Engine, GenerationKind, Video } from "@/lib/types";

/**
 * POST /api/videos/create-record
 * Creates a library entry without running the generator (used after an
 * external render finishes).
 */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = await readJson<Record<string, unknown>>(request);
  const title = str(body.title).trim();
  if (!title) return fail(400, "title is required.");

  const id = newVideoId();
  const kind: GenerationKind = str(body.kind) === "podcast" ? "podcast" : "video";
  const video = await createVideoRecord({
    id,
    user_id: user.id,
    job_id: null,
    title,
    status: "ready",
    kind,
    engine: (str(body.engine, "golpo_canvas") as Engine) ?? "golpo_canvas",
    style: str(body.style, "whiteboard"),
    image_style: str(body.image_style) || null,
    pen_style: str(body.pen_style) || null,
    language: str(body.language, "en"),
    display_language: str(body.display_language, "English"),
    duration_seconds: Math.max(1, Math.trunc(Number(body.duration_seconds) || 60)),
    visibility: str(body.visibility) === "public" ? "public" : "private",
    script: str(body.script) || null,
    scenes: Array.isArray(body.scenes) ? (body.scenes as Video["scenes"]) : null,
    video_url: str(body.video_url) || `/api/media/${id}/preview`,
    poster_url: str(body.poster_url) || `/api/media/${id}/poster`,
    media_format: str(body.video_url).endsWith(".mp4") ? "mp4" : "svg",
    watermark: Boolean(body.watermark),
    is_audio_only: kind === "podcast",
    variant_of: null,
    variant_language: null,
    error: null,
  });
  return json({ success: true, video });
}
