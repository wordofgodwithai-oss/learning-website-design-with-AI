import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextResponse } from "next/server";

import { getUserById } from "@/lib/repo";
import { authMode } from "@/lib/integrations";
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

/**
 * Supabase fallbacks.
 *
 * With GOLPO_AUTH_MODE=supabase the OAuth callback still mints the HMAC
 * `golpo_session` cookie, so the normal path above keeps working. These helpers
 * additionally accept raw Supabase access tokens (in `Authorization: Bearer`)
 * and Supabase's own SSR cookies, which matters for API clients and for the
 * brief window before the bridge cookie exists.
 */

async function userFromSupabaseCookie(): Promise<User | null> {
  if (authMode !== "supabase") return null;
  try {
    const [{ createSupabaseServerClient }, { identityFromSupabase }] = await Promise.all([
      import("@/lib/supabase/server"),
      import("@/lib/supabase/verify"),
    ]);
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return null;
    const identity = identityFromSupabase({
      id: data.user.id,
      email: data.user.email,
      user_metadata: data.user.user_metadata,
      app_metadata: data.user.app_metadata,
    });
    if (!identity) return null;
    const { upsertUser } = await import("@/lib/repo");
    return upsertUser({
      email: identity.email,
      name: identity.name,
      provider: identity.provider,
      avatarUrl: identity.avatarUrl,
      externalId: identity.externalId,
    });
  } catch {
    return null;
  }
}

async function userFromSupabaseBearer(token: string): Promise<User | null> {
  if (authMode !== "supabase") return null;
  try {
    const { userFromSupabaseToken } = await import("@/lib/supabase/verify");
    return await userFromSupabaseToken(token);
  } catch {
    return null;
  }
}

/** Cookie-only lookup, for server components. */
export async function getSessionUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const payload = verifyAccessToken(token);
    if (payload) {
      const user = await getUserById(payload.sub);
      if (user) return user;
    }
  }
  return userFromSupabaseCookie();
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
    const bearer = header.slice(7).trim();
    const payload = verifyAccessToken(bearer);
    if (payload) return (await getUserById(payload.sub)) ?? null;
    const supabaseUser = await userFromSupabaseBearer(bearer);
    if (supabaseUser) return supabaseUser;
  }
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (match) {
    const token = decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));
    const payload = verifyAccessToken(token);
    if (payload) return (await getUserById(payload.sub)) ?? null;
  }
  return userFromSupabaseCookie();
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
