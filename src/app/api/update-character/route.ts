import { getUserFromRequest } from "@/lib/auth";
import { fail, json, readJson, str } from "@/lib/http";
import { updateCharacter } from "@/lib/repo";

/** POST /api/update-character */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = await readJson<Record<string, unknown>>(request);
  const id = str(body.id);
  if (!id) return fail(400, "id is required.");
  const character = await updateCharacter(user.id, id, {
    ...(body.name !== undefined ? { name: str(body.name) } : {}),
    ...(body.description !== undefined ? { description: str(body.description) } : {}),
    ...(body.image_url !== undefined ? { image_url: str(body.image_url) || null } : {}),
  });
  if (!character) return fail(404, "Character not found.");
  return json({ success: true, character });
}
