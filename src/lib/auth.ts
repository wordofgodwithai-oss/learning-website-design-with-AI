import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextResponse } from "next/server";

import {
  getUserById,
  insertSession,
  lookupSession,
  removeSession,
} from "@/lib/repo";
import type { PublicUser, User } from "@/lib/types";

/**
 * MySQL-backed sessions.
 *
 * Sign-in issues a random opaque token (`insertSession`) and stores only its
 * SHA-256 in the `sessions` table. The same token travels in two places:
 *
 *   - an httpOnly `golpo_session` cookie for page loads and fetch() calls
 *   - `Authorization: Bearer <token>` for the BFF and public API
 *
 * Because the token is opaque, sign-out can revoke it server-side by deleting
 * the row; there is no HMAC secret to leak or rotate.
 */

export const SESSION_COOKIE = "golpo_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface SessionPayload {
  sub: string;
  iat: number;
  exp: number;
}

/** Creates a new session row and returns the plaintext token. */
export async function createSession(user: User): Promise<{ token: string; expiresAt: number }> {
  return insertSession(user.id, SESSION_TTL_SECONDS);
}

/** Resolves a token to its session payload, or null when unknown/expired. */
export async function verifyAccessToken(token: string): Promise<SessionPayload | null> {
  const session = await lookupSession(token);
  if (!session) return null;
  const expiresAt = Math.floor(new Date(session.expires_at).getTime() / 1_000);
  return {
    sub: session.user_id,
    iat: Math.floor(Date.now() / 1_000),
    exp: expiresAt,
  };
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    display_name: user.display_name,
    provider: user.provider,
    avatar_url: user.avatar_url,
  };
}

async function userForToken(token: string): Promise<User | null> {
  const payload = await verifyAccessToken(token);
  if (!payload) return null;
  return (await getUserById(payload.sub)) ?? null;
}

/** The raw session token from the cookie, if any. */
export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/** Cookie-only lookup, for server components. */
export async function getSessionUser(): Promise<User | null> {
  const token = await getSessionToken();
  if (!token) return null;
  return userForToken(token);
}

/**
 * Server-component guard. Returns the user together with the session token so
 * pages can hand the same credential to client components (the token the
 * browser already holds in its cookie).
 */
export async function requireSession(
  nextPath = "/playground",
): Promise<{ user: User; token: string }> {
  const token = await getSessionToken();
  const user = token ? await userForToken(token) : null;
  if (!user || !token) {
    redirect(`/?redirect=${encodeURIComponent(nextPath)}`);
  }
  return { user, token };
}

/** Server-component guard that only needs the user. */
export async function requireSessionUser(nextPath = "/playground"): Promise<User> {
  return (await requireSession(nextPath)).user;
}

/** Bearer header first (BFF/API contract), then the session cookie. */
export async function getUserFromRequest(request: Request): Promise<User | null> {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const user = await userForToken(header.slice(7).trim());
    if (user) return user;
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  const token = decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));
  return userForToken(token);
}

/** Revokes the session behind `token` (sign-out). */
export async function destroySession(token: string): Promise<void> {
  await removeSession(token);
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    secure: process.env.NODE_ENV === "production",
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({ name: SESSION_COOKIE, value: "", path: "/", maxAge: 0 });
}
