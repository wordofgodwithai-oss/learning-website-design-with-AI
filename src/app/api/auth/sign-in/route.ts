import { issueSession, safeRedirect } from "@/lib/auth-response";
import { verifyPassword } from "@/lib/password";
import { fail, readJson, str } from "@/lib/http";
import { ensureDemoUser, getPasswordHash, getUserByEmail, upsertUser } from "@/lib/repo";

/**
 * POST /api/auth/sign-in
 *
 * Two credential shapes:
 *
 *   { "provider": "dev" }                     demo account, one click
 *   { "email": "...", "password": "..." }     MySQL account
 *
 * Successful sign-in creates a row in `sessions` and returns its opaque token
 * both as an httpOnly cookie and as `access_token` for the BFF/API bearer
 * contract.
 */
export async function POST(request: Request) {
  const body = await readJson<Record<string, unknown>>(request);
  const redirectTo = safeRedirect(str(body.redirect, "/playground"));
  const provider = str(body.provider).trim().toLowerCase();

  if (provider === "dev") {
    const user = await ensureDemoUser();
    return issueSession(user, redirectTo);
  }

  if (provider === "google" || provider === "microsoft") {
    return fail(
      400,
      "OAuth sign-in is not available. Sign in with your email and password, or use the demo account.",
      { provider },
    );
  }

  const email = str(body.email).trim().toLowerCase();
  const password = str(body.password);
  if (!email || !password) {
    return fail(400, "Enter your email and password.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail(400, "Enter a valid email address.");
  }

  const user = await getUserByEmail(email);
  const hash = user ? await getPasswordHash(email) : null;
  if (!user || !hash || !(await verifyPassword(password, hash))) {
    return fail(401, "Incorrect email or password.");
  }

  // Refresh last_login_at without touching the provider or the password hash.
  const updated = await upsertUser({
    email: user.email,
    name: user.name,
    provider: user.provider,
    avatarUrl: user.avatar_url,
    externalId: user.external_id ?? null,
  });

  return issueSession(updated, redirectTo);
}
