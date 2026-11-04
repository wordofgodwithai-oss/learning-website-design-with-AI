import { getUserFromRequest } from "@/lib/auth";
import { fail, json, readJson, str } from "@/lib/http";
import { createPlaylist, listPlaylists } from "@/lib/repo";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  return json({ success: true, playlists: await listPlaylists(user.id) });
}

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = await readJson<Record<string, unknown>>(request);
  const name = str(body.name).trim();
  if (!name) return fail(400, "name is required.");
  const videoIds = Array.isArray(body.video_ids) ? body.video_ids.map(String) : [];
  const playlist = await createPlaylist(user.id, {
    name,
    description: str(body.description),
    video_ids: videoIds,
  });
  return json({ success: true, playlist });
}
