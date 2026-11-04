import { createAccessToken, getSessionUser } from "@/lib/auth";
import { fail, json } from "@/lib/http";

/** Mirrors the Supabase access token the dashboard exposes to its own JS. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return fail(401, "Not authenticated.");
  const { token, expiresAt } = createAccessToken(user);
  return json({
    access_token: token,
    token_type: "bearer",
    expires_at: expiresAt,
    user_id: user.id,
    email: user.email,
  });
}
