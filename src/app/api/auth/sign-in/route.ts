import { NextResponse } from "next/server";

import { createAccessToken, setSessionCookie, toPublicUser } from "@/lib/auth";
import { getBalance } from "@/lib/billing/mock-billing";
import { featureMatrix } from "@/lib/features";
import { fail, readJson, str } from "@/lib/http";
import { upsertUser } from "@/lib/repo";

/**
 * Mock OAuth sign-in.
 *
 * The real modal only offers "Continue with Google" and "Continue with
 * Microsoft" (REPORT.md section 4). Locally we accept the provider, mint a
 * local account for the supplied email and issue the same kind of bearer token
 * the dashboard would forward to the BFF.
 */
export async function POST(request: Request) {
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
    mocked_billing: true,
    features: featureMatrix(),
  });
  setSessionCookie(response, token);
  return response;
}
