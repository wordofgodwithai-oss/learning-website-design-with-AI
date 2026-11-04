import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { listApiKeys } from "@/lib/repo";

/** GET /api/api-keys — metadata only, never the hash or plaintext. */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const keys = await listApiKeys(user.id);
  return json({
    success: true,
    api_keys: keys.map(({ key_hash, ...rest }) => ({ ...rest, hash_hidden: Boolean(key_hash) })),
  });
}
