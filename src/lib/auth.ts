import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextResponse } from "next/server";

import { getUserById } from "@/lib/repo";
import type { PublicUser, User } from "@/lib/types";

/**
 * Local auth.
 *
 * The production app uses Supabase GoTrue and keeps the access token in
 * `localStorage["sb-…-auth-token"]` (REPORT.md section 4). Locally we issue the
 * same kind of bearer token ourselves (HMAC-signed, with an expiry) and keep it
 * in an httpOnly cookie for page loads. The token is also accepted in an
 * `Authorization: Bearer` header so the BFF contract is identical to the real
 * dashboard, which forwards the Supabase access token to its route handlers.
 *
 * TODO(REAL-AUTH): swap this module for @supabase/ssr with Google + Microsoft
 * OAuth. Everything downstream only depends on `getSessionUser()`.
 */

export const SESSION_COOKIE = "golpo_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const SECRET =
  process.env.GOLPO_SESSION_SECRET ?? "golpo-local-dev-secret-do-not-use-in-production";

export interface SessionPayload {
  sub: string;
  email: string;
  provider: string;
  iat: number;
  exp: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function createAccessToken(user: User): { token: string; expiresAt: number } {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: user.id,
    email: user.email,
    provider: user.provider,
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS,
  };
  const encoded = base64url(JSON.stringify(payload));
  return { token: `${encoded}.${sign(encoded)}`, expiresAt: payload.exp };
}

export function verifyAccessToken(token: string): SessionPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(encoded);
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (!payload.sub || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
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

/** Cookie-only lookup, for server components. */
export async function getSessionUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = verifyAccessToken(token);
  if (!payload) return null;
  return (await getUserById(payload.sub)) ?? null;
}

/** Server-component guard: redirect anonymous visitors to the landing page. */
export async function requireSessionUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) {
    // The real dashboard keeps the destination in
    // sessionStorage["redirectAfterLogin"]; a query parameter survives the
    // server-side redirect just as well and needs no client code.
    redirect("/?redirect=%2Fplayground");
  }
  return user;
}

/** Bearer header first (BFF/API contract), then the session cookie. */
export async function getUserFromRequest(request: Request): Promise<User | null> {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const payload = verifyAccessToken(header.slice(7).trim());
    if (payload) return (await getUserById(payload.sub)) ?? null;
  }
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  const token = decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));
  const payload = verifyAccessToken(token);
  if (!payload) return null;
  return (await getUserById(payload.sub)) ?? null;
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
