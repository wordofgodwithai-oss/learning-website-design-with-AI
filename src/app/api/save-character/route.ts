import { getUserFromRequest } from "@/lib/auth";
import { fail, json, readJson, str } from "@/lib/http";
import { createCharacter } from "@/lib/repo";

/** POST /api/save-character */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = await readJson<Record<string, unknown>>(request);
  const name = str(body.name).trim();
  if (!name) return fail(400, "A character name is required.");
  const character = await createCharacter(user.id, {
    name,
    description: str(body.description),
    image_url: str(body.image_url) || null,
  });
  return json({ success: true, character });
}
