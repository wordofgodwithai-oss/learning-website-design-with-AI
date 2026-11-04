import { getUserFromRequest } from "@/lib/auth";
import { fail, json, readJson, str } from "@/lib/http";
import { deleteCharacter } from "@/lib/repo";

/** POST /api/delete-character */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = await readJson<Record<string, unknown>>(request);
  const id = str(body.id ?? body.character_id);
  if (!id) return fail(400, "id is required.");
  const removed = await deleteCharacter(user.id, id);
  if (!removed) return fail(404, "Character not found.");
  return json({ success: true });
}
