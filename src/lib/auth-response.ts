import "server-only";

import { NextResponse } from "next/server";

import { createSession, setSessionCookie, toPublicUser } from "@/lib/auth";
import { getBalance } from "@/lib/billing";
import { featureMatrix } from "@/lib/features";
import type { User } from "@/lib/types";

/**
 * Shared sign-in / sign-up response.
 *
 * Every successful credential exchange issues a MySQL session, sets the
 * httpOnly cookie and returns the same envelope the dashboard's BFF exposes
 * (`access_token`, credits, plan, feature matrix).
 */
export async function issueSession(
  user: User,
  redirectTo: string,
  status = 200,
): Promise<NextResponse> {
  const { token, expiresAt } = await createSession(user);
  const balance = await getBalance(user.id);

  const response = NextResponse.json(
    {
      success: true,
      user: toPublicUser(user),
      access_token: token,
      token_type: "bearer",
      expires_at: expiresAt,
      redirect: redirectTo,
      credits: balance.credits,
      plan: balance.plan,
      addons: balance.addons,
      unlimited: balance.unlimited,
      mocked_billing: balance.mocked,
      features: featureMatrix(balance),
    },
    { status },
  );
  setSessionCookie(response, token);
  return response;
}

/** Only same-origin absolute paths may be used as a post-login destination. */
export function safeRedirect(value: string | undefined, fallback = "/playground"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}
