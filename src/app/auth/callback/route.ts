import { NextResponse } from "next/server";

import { authMode } from "@/lib/integrations";
import { createAccessToken, setSessionCookie } from "@/lib/auth";
import { upsertUser } from "@/lib/repo";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { identityFromSupabase } from "@/lib/supabase/verify";

/**
 * OAuth callback for GOLPO_AUTH_MODE=supabase.
 *
 * Supabase exchanges the OAuth code and sets its own cookies. We then mirror the
 * identity into the local store and mint the same HMAC session token every BFF
 * route already understands, so enabling real auth does not require changing a
 * single downstream route.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawNext = url.searchParams.get("next") ?? url.searchParams.get("redirect") ?? "/playground";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/playground";

  const failure = (message: string) =>
    NextResponse.redirect(
      new URL(`/?auth_error=${encodeURIComponent(message)}`, url.origin),
    );

  if (authMode !== "supabase") return failure("Supabase auth is not enabled.");
  if (!code) return failure("The provider did not return an authorization code.");

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failure(error.message);
    if (!data.user) return failure("Supabase did not return a user.");

    const identity = identityFromSupabase({
      id: data.user.id,
      email: data.user.email,
      user_metadata: data.user.user_metadata,
      app_metadata: data.user.app_metadata,
    });
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
