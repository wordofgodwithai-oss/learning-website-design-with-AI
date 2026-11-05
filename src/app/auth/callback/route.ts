import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { authMode } from "@/lib/integrations";
import { createAccessToken, setSessionCookie } from "@/lib/auth";
import { upsertUser } from "@/lib/repo";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { identityFromSupabase } from "@/lib/supabase/verify";

/**
 * OAuth / magic-link callback for GOLPO_AUTH_MODE=supabase.
 *
 * Handles both shapes Supabase can send back:
 *   - `?code=...`      OAuth and PKCE magic links (exchanged for a session)
 *   - `?token_hash=...&type=magiclink`
 *                       email links rendered against this URL directly
 *
 * We then mirror the identity into the local store and mint the same HMAC
 * session token every BFF route already understands, so enabling real auth does
 * not require changing a single downstream route.
 */

const OTP_TYPES: readonly EmailOtpType[] = [
  "magiclink",
  "signup",
  "recovery",
  "invite",
  "email_change",
  "email",
];

function isOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (OTP_TYPES as readonly string[]).includes(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const otpType = url.searchParams.get("type");
  const rawNext = url.searchParams.get("next") ?? url.searchParams.get("redirect") ?? "/playground";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/playground";

  const failure = (message: string) =>
    NextResponse.redirect(
      new URL(`/?auth_error=${encodeURIComponent(message)}`, url.origin),
    );

  if (authMode !== "supabase") return failure("Supabase auth is not enabled.");

  try {
    const supabase = await createSupabaseServerClient();
    let authUser: {
      id: string;
      email?: string;
      user_metadata?: Record<string, unknown>;
      app_metadata?: Record<string, unknown>;
    } | null = null;

    if (tokenHash && isOtpType(otpType)) {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: otpType,
      });
      if (error) return failure(error.message);
      authUser = data.user;
    } else if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return failure(error.message);
      authUser = data.user;
    } else {
      return failure("This sign-in link is missing its token. Request a new link.");
    }

    if (!authUser) return failure("Supabase did not return a user.");

    const identity = identityFromSupabase(authUser);
    if (!identity) return failure("The Supabase account has no email address.");

    const user = await upsertUser({
      email: identity.email,
      name: identity.name,
      provider: identity.provider,
      avatarUrl: identity.avatarUrl,
      externalId: identity.externalId,
    });

    const { token } = createAccessToken(user);
    const response = NextResponse.redirect(new URL(next, url.origin));
    setSessionCookie(response, token);
    return response;
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Sign-in failed.");
  }
}
