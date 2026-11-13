import { issueSession, safeRedirect } from "@/lib/auth-response";
import { fail, readJson, str } from "@/lib/http";
import { hashPassword, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "@/lib/password";
import { createPasswordUser, getUserByEmail } from "@/lib/repo";

/**
 * POST /api/auth/sign-up
 *
 *   { "email": "...", "password": "...", "name": "..." }
 *
 * Creates a MySQL account with a scrypt hash and signs the new user in. The
 * email column is unique, so a duplicate registration is rejected with 409
 * rather than silently merging into the existing account.
 */
export async function POST(request: Request) {
  const body = await readJson<Record<string, unknown>>(request);
  const redirectTo = safeRedirect(str(body.redirect, "/playground"));

  const email = str(body.email).trim().toLowerCase();
  const password = str(body.password);
  const name = str(body.name).trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail(400, "Enter a valid email address.");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(400, `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return fail(400, `Use at most ${MAX_PASSWORD_LENGTH} characters for your password.`);
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    return fail(409, "An account with that email already exists. Sign in instead.");
  }

  const user = await createPasswordUser({
    email,
    name: name || undefined,
    passwordHash: await hashPassword(password),
  });
  if (!user) {
    return fail(409, "An account with that email already exists. Sign in instead.");
  }

  return issueSession(user, redirectTo, 201);
}
