import { getUserFromRequest } from "@/lib/auth";
import { fail, json, readJson, str } from "@/lib/http";
import { createApiKey } from "@/lib/repo";

/**
 * POST /api/create-api-key
 * The plaintext key is returned exactly once, then only its SHA-256 hash is
 * stored — the same trade-off the real API-key panel makes.
 */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = await readJson<Record<string, unknown>>(request);
  const { record, plaintext } = await createApiKey(user.id, str(body.name, "Dashboard key"));
  return json({
    success: true,
    key: plaintext,
    api_key: record,
    warning: "Store this key now. It cannot be shown again.",
  });
}
