import { getSessionToken, getSessionUser, verifyAccessToken } from "@/lib/auth";
import { fail, json } from "@/lib/http";

/** Returns the current session token in the same shape as before. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return fail(401, "Not authenticated.");
  const token = await getSessionToken();
  if (!token) return fail(401, "Not authenticated.");
  const session = await verifyAccessToken(token);
  return json({
    access_token: token,
    token_type: "bearer",
    expires_at: session?.exp ?? Math.floor(Date.now() / 1_000) + 60 * 60 * 24 * 30,
    user_id: user.id,
    email: user.email,
  });
}
