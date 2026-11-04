import { getUserFromRequest } from "@/lib/auth";
import { fail, json, readJson, str } from "@/lib/http";
import { deletePlaylist, listPlaylists, updatePlaylist } from "@/lib/repo";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const { id } = await params;
  const playlist = (await listPlaylists(user.id)).find((row) => row.id === id);
  if (!playlist) return fail(404, "Playlist not found.");
  return json({ success: true, playlist });
}

export async function PATCH(request: Request, { params }: Context) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const { id } = await params;
  const body = await readJson<Record<string, unknown>>(request);
  const playlist = await updatePlaylist(user.id, id, {
    ...(body.name !== undefined ? { name: str(body.name) } : {}),
    ...(body.description !== undefined ? { description: str(body.description) } : {}),
    ...(Array.isArray(body.video_ids) ? { video_ids: body.video_ids.map(String) } : {}),
  });
  if (!playlist) return fail(404, "Playlist not found.");
  return json({ success: true, playlist });
}

export async function DELETE(request: Request, { params }: Context) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const { id } = await params;
  const removed = await deletePlaylist(user.id, id);
  if (!removed) return fail(404, "Playlist not found.");
  return json({ success: true });
}
