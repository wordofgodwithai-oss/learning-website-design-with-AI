import { NextResponse } from "next/server";

import { createAccessToken, setSessionCookie, toPublicUser } from "@/lib/auth";
import { getBalance } from "@/lib/billing";
import { featureMatrix } from "@/lib/features";
import { authMode } from "@/lib/integrations";
import { fail, readJson, str } from "@/lib/http";
import { upsertUser } from "@/lib/repo";

/**
 * Local sign-in.
 *
 * In `local` mode this is the mock OAuth endpoint: it accepts a provider and
 * email, mints a local account and issues an HMAC bearer token. In `supabase`
 * mode real sign-in happens through Supabase OAuth and `/auth/callback`, so
 * this endpoint is disabled to avoid shadow accounts.
 */
export async function POST(request: Request) {
  if (authMode === "supabase") {
    return fail(409, "Local sign-in is disabled while Supabase auth is enabled.", {
      auth_mode: authMode,
      use_oauth: true,
    });
  }

  const body = await readJson<Record<string, unknown>>(request);
  const provider = str(body.provider, "google");
  if (provider !== "google" && provider !== "microsoft" && provider !== "dev") {
    return fail(400, "Unsupported provider.");
  }

  const email = str(body.email, "demo@golpo.local").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail(400, "Enter a valid email address.");
  }

  const user = await upsertUser({
    email,
    name: str(body.name) || undefined,
    provider,
  });

  const { token, expiresAt } = createAccessToken(user);
  const balance = await getBalance(user.id);

  const response = NextResponse.json({
    success: true,
    user: toPublicUser(user),
    access_token: token,
    token_type: "bearer",
    expires_at: expiresAt,
    redirect: str(body.redirect, "/playground"),
    credits: balance.credits,
    plan: balance.plan,
    unlimited: balance.unlimited,
    mocked_billing: balance.mocked,
    features: featureMatrix(balance),
  });
  setSessionCookie(response, token);
  return response;
}
