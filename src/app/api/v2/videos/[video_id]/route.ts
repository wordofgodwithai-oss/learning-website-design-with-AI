import { requireApiKey } from "@/lib/api-auth";
import { fail, json, readJson, str } from "@/lib/http";
import { getVideo, updateVideo } from "@/lib/repo";
import type { Visibility } from "@/lib/types";

/**
 * PATCH /api/v2/videos/{video_id}
 * v2 deliberately allows only title and visibility changes.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ video_id: string }> },
) {
  const identity = await requireApiKey(request);
  if (identity instanceof Response) return identity;
  const { video_id } = await params;
  const body = await readJson<Record<string, unknown>>(request);

  const existing = await getVideo(video_id, identity.user.id);
  if (!existing) return fail(404, "Video not found.", { code: "video_not_found" });

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const title = str(body.title).trim();
    if (!title) return fail(400, "title cannot be empty.");
    if (title.length > 160) return fail(400, "title is too long (160 characters maximum).");
    patch.title = title;
  }
  if (body.visibility !== undefined) {
    const visibility = str(body.visibility);
    if (!["private", "public", "unlisted"].includes(visibility)) {
      return fail(400, "visibility must be private, public or unlisted.");
    }
    patch.visibility = visibility as Visibility;
  }
  if (Object.keys(patch).length === 0) {
    return fail(400, "v2 only supports title and visibility updates.");
  }

  const video = await updateVideo(video_id, patch);
  if (!video) return fail(404, "Video not found.");
  return json({ success: true, video });
}
