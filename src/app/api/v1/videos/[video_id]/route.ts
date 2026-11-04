import { requireApiKey } from "@/lib/api-auth";
import { fail, json, readJson, str } from "@/lib/http";
import { deleteVideo, getVideo, updateVideo } from "@/lib/repo";
import type { Visibility } from "@/lib/types";

type Context = { params: Promise<{ video_id: string }> };

export async function GET(request: Request, { params }: Context) {
  const identity = await requireApiKey(request);
  if (identity instanceof Response) return identity;
  const { video_id } = await params;
  const video = await getVideo(video_id, identity.user.id);
  if (!video) return fail(404, "Video not found.", { code: "video_not_found" });
  return json({ success: true, video });
}

export async function PATCH(request: Request, { params }: Context) {
  const identity = await requireApiKey(request);
  if (identity instanceof Response) return identity;
  const { video_id } = await params;
  const body = await readJson<Record<string, unknown>>(request);

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const title = str(body.title).trim();
    if (!title) return fail(400, "title cannot be empty.");
    patch.title = title;
  }
  if (body.visibility !== undefined) {
    const visibility = str(body.visibility);
    if (!["private", "public", "unlisted"].includes(visibility)) {
      return fail(400, "visibility must be private, public or unlisted.");
    }
    patch.visibility = visibility as Visibility;
  }
  if (Object.keys(patch).length === 0) return fail(400, "Nothing to update.");

  const video = await updateVideo(video_id, patch);
  if (!video || video.user_id !== identity.user.id) {
    return fail(404, "Video not found.", { code: "video_not_found" });
  }
  return json({ success: true, video });
}

export async function DELETE(request: Request, { params }: Context) {
  const identity = await requireApiKey(request);
  if (identity instanceof Response) return identity;
  const { video_id } = await params;
  const removed = await deleteVideo(video_id, identity.user.id);
  if (!removed) return fail(404, "Video not found.", { code: "video_not_found" });
  return json({ success: true, deleted: video_id });
}
