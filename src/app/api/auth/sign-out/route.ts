import { NextResponse } from "next/server";

import { clearSessionCookie, destroySession, getSessionToken } from "@/lib/auth";

/**
 * POST /api/auth/sign-out
 *
 * Deletes the session row (so the bearer token is revoked immediately) and
 * clears the cookie.
 */
export async function POST() {
  const token = await getSessionToken();
  if (token) await destroySession(token);
  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  return response;
}
