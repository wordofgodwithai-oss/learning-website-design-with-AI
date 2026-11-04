import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { listVoiceClones } from "@/lib/repo";

/** GET /api/get-user-voice-clones — `{success, user_id, count, voice_clones[]}`. */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const voice_clones = await listVoiceClones(user.id);
  return json({ success: true, user_id: user.id, count: voice_clones.length, voice_clones });
}
