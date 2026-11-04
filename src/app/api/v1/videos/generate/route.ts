import { requireApiKey } from "@/lib/api-auth";
import { fail, json } from "@/lib/http";
import { normalizeGenerationInput } from "@/lib/generation/request";
import { startGeneration } from "@/lib/generation/pipeline";
import { generationErrorResponse, readGenerationBody } from "@/lib/generation/http";

/**
 * POST /api/v1/videos/generate
 *
 * Public API v1: multipart/form-data, authenticated with `x-api-key`
 * (REPORT.md section 7). Returns a job immediately; poll
 * `/api/v1/videos/status/{job_id}`.
 */
export async function POST(request: Request) {
  const identity = await requireApiKey(request);
  if (identity instanceof Response) return identity;

  try {
    const { fields, uploadUrls } = await readGenerationBody(request, identity.user.id);
    const input = normalizeGenerationInput(fields, { uploadUrls });
    const snapshot = await startGeneration(identity.user, input);
    return json(
      {
        success: true,
        job_id: snapshot.job_id,
        video_id: snapshot.video_id,
        status: snapshot.status,
        stage: snapshot.stage,
        progress: snapshot.progress,
        script: snapshot.script,
        variant_video_ids: snapshot.variant_video_ids,
        status_url: `/api/v1/videos/status/${snapshot.job_id}`,
      },
      202,
    );
  } catch (error) {
    return generationErrorResponse(error);
  }
}

export async function GET() {
  return fail(405, "Use POST with multipart/form-data to generate a video.");
}
