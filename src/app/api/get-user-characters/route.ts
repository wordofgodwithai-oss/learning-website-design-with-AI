import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { listCharacters } from "@/lib/repo";

/** GET /api/get-user-characters — `{success, characters[]}`. */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const characters = await listCharacters(user.id);
  return json({ success: true, characters });
}
