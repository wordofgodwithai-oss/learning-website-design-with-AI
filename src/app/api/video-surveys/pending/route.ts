import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { listVideos } from "@/lib/repo";

/**
 * GET /api/video-surveys/pending
 * Suggests a survey after the user has a few ready videos, mirroring the
 * in-app feedback prompt. No survey UI ships in this scaffold.
 */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const videos = await listVideos(user.id, { limit: 100 });
  const ready = videos.filter((video) => video.status === "ready");
  const pending = ready.length >= 3 ? [{ id: "survey_local_1", type: "satisfaction" }] : [];
  return json({ success: true, surveys: pending });
}
