import { requireApiKey } from "@/lib/api-auth";
import { fail, json, readJson } from "@/lib/http";
import { normalizeGenerationInput } from "@/lib/generation/request";
import { startGeneration } from "@/lib/generation/pipeline";
import { generationErrorResponse } from "@/lib/generation/http";

/**
 * POST /api/v2/videos/generate — JSON body (REPORT.md section 7).
 *
 * v2 vocabulary: golpo_video_engine (golpo_canvas|golpo_sketch),
 * canvas_style_variant, sketch_style_variant, narration_voice,
 * narration_language, scene_pacing, pen_animation_style, watermark,
 * background_track, video_orientation, own_narration_*, visibility,
 * onscreen_text_language.
 */
export async function POST(request: Request) {
  const identity = await requireApiKey(request);
  if (identity instanceof Response) return identity;

  const body = await readJson<Record<string, unknown>>(request);
  if (!body || Object.keys(body).length === 0) {
    return fail(400, "Send a JSON body with at least a prompt.");
  }

  try {
    const fields: Record<string, unknown> = {
      ...body,
      pacing: body.scene_pacing ?? body.pacing,
      pen_style: body.pen_animation_style ?? body.pen_style,
      voiceName: body.narration_voice ?? body.voiceName,
      language: body.narration_language ?? body.language,
      display_language: body.onscreen_text_language ?? body.display_language,
      durationSeconds: body.duration ?? body.durationSeconds,
      is_public: body.visibility === "public",
    };

    const input = normalizeGenerationInput(fields);
    const snapshot = await startGeneration(identity.user, input);
    return json(
      {
        success: true,
        job_id: snapshot.job_id,
        video_id: snapshot.video_id,
        status: snapshot.status,
        status_url: `/api/v1/videos/status/${snapshot.job_id}`,
        video: snapshot.video,
      },
      202,
    );
  } catch (error) {
    return generationErrorResponse(error);
  }
}
