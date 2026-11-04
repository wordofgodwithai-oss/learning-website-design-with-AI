import { getUserFromRequest } from "@/lib/auth";
import { authenticateApiKey } from "@/lib/api-auth";
import { fail, json, readJson, str } from "@/lib/http";
import { regenerateVideo } from "@/lib/generation/pipeline";
import { generationErrorResponse } from "@/lib/generation/http";

/** POST /api/regenerate — re-runs a previous job with optional overrides. */
export async function POST(request: Request) {
  const user = (await getUserFromRequest(request)) ?? (await authenticateApiKey(request))?.user;
  if (!user) return fail(401, "Authentication failed. Please sign in again.");

  try {
    const contentType = request.headers.get("content-type") ?? "";
    let body: Record<string, unknown>;
    if (contentType.includes("application/json")) {
      body = await readJson<Record<string, unknown>>(request);
    } else {
      const form = await request.formData();
      body = Object.fromEntries(form.entries());
    }
    const videoId = str(body.video_id ?? body.videoId ?? body.id);
    if (!videoId) return fail(400, "video_id is required.");
    const snapshot = await regenerateVideo(user, videoId, body);
    return json(snapshot);
  } catch (error) {
    return generationErrorResponse(error);
  }
}
