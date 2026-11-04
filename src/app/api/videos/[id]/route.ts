import { getUserFromRequest } from "@/lib/auth";
import { fail, json, readJson, str } from "@/lib/http";
import { deleteVideo, getVideo, updateVideo } from "@/lib/repo";
import type { Visibility } from "@/lib/types";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const { id } = await params;
  const video = await getVideo(id, user.id);
  if (!video) return fail(404, "Video not found.");
  return json({ success: true, video });
}

/** PATCH /api/videos/{id} — title, visibility and privacy flags. */
export async function PATCH(request: Request, { params }: Context) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const { id } = await params;
  const body = await readJson<Record<string, unknown>>(request);

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
  if (body.is_public !== undefined) {
    patch.visibility = body.is_public ? "public" : "private";
  }
  if (Object.keys(patch).length === 0) {
    return fail(400, "Nothing to update. Send title and/or visibility.");
  }

  const video = await updateVideo(id, patch);
  if (!video || video.user_id !== user.id) return fail(404, "Video not found.");
  return json({ success: true, video });
}

export async function DELETE(request: Request, { params }: Context) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const { id } = await params;
  const removed = await deleteVideo(id, user.id);
  if (!removed) return fail(404, "Video not found.");
  return json({ success: true });
}
