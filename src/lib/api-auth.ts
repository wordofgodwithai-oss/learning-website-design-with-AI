import "server-only";

import { findApiKeyByPlaintext, getUserById, touchApiKey } from "@/lib/repo";
import type { ApiKey, User } from "@/lib/types";
import { fail } from "@/lib/http";

export interface ApiKeyIdentity {
  user: User;
  key: ApiKey;
}

function extractKey(request: Request): string | null {
  const direct = request.headers.get("x-api-key");
  if (direct?.trim()) return direct.trim();
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const value = header.slice(7).trim();
    if (value.startsWith("glp_")) return value;
  }
  return null;
}

/** Returns the identity behind an `x-api-key`, or null. */
export async function authenticateApiKey(request: Request): Promise<ApiKeyIdentity | null> {
  const plaintext = extractKey(request);
  if (!plaintext) return null;
  const key = await findApiKeyByPlaintext(plaintext);
  if (!key) return null;
  const user = await getUserById(key.user_id);
  if (!user) return null;
  await touchApiKey(key.id);
  return { user, key };
}

/** Public API guard: 401 with the documented error envelope. */
export async function requireApiKey(
  request: Request,
): Promise<ApiKeyIdentity | Response> {
  const identity = await authenticateApiKey(request);
  if (!identity) {
    return fail(401, "Invalid or missing API key. Pass your key in the x-api-key header.", {
      code: "invalid_api_key",
    });
  }
  return identity;
}
