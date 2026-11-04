import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { AVATAR_STYLIZATION } from "@/lib/generation/config";

/**
 * GET /api/avatars — `{success, avatars, stylization_enabled}`.
 * Uploaded avatars would live here; the stock catalogue is /api/stock-avatars.
 */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  return json({ success: true, avatars: [], stylization_enabled: AVATAR_STYLIZATION });
}
