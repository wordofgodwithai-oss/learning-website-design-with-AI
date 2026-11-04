import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { listCustomMusic } from "@/lib/repo";

/** GET /api/get-user-custom-music — `{success, user_id, count, custom_music[]}`. */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const custom_music = await listCustomMusic(user.id);
  return json({ success: true, user_id: user.id, count: custom_music.length, custom_music });
}
