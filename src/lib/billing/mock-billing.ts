import "server-only";

import { getCreditAccount } from "@/lib/repo";
import { MOCK_INFINITE_CREDITS } from "@/lib/billing/constants";

/**
 * ===========================================================================
 * MOCK BILLING — local development only.
 *
 * Balances are always MOCK_INFINITE_CREDITS and nothing is ever charged.
 * Every function here returns a `mocked: true` marker so it is impossible to
 * mistake a local response for a real Stripe result.
 *
 * TODO(REAL-BILLING): implement the flows from REPORT.md section 8 —
 *   create-stripe-session, plan-upgrade/checkout + complete,
 *   annual-upgrade/options + checkout, create-customer-portal-session,
 *   cancel / pause / resume subscription, can-pause-subscription, remove-addon —
 *   against Stripe with webhook-driven ledger updates. The client contract
 *   (route names + response envelope) should stay the same so the UI does not
 *   need to change.
 * ===========================================================================
 */

export interface LocalBalance {
  user_id: string;
  credits: number;
  plan: string;
  unlimited: true;
  mocked: true;
  next_subscription_date: string | null;
  subscription_canceled: boolean;
  addons: Record<string, boolean>;
}

export async function getBalance(userId: string): Promise<LocalBalance> {
  const account = await getCreditAccount(userId);
  return {
    user_id: userId,
    // Hard-coded so a corrupted/edited ledger can never lock the dev out.
    credits: MOCK_INFINITE_CREDITS,
    plan: account?.plan ?? "local-unlimited",
    unlimited: true,
    mocked: true,
    next_subscription_date: account?.next_subscription_date ?? null,
    subscription_canceled: false,
    addons: {
      watermark: true,
      lang: true,
      script: true,
      video_instruction: true,
      logo: true,
      team: true,
      api: true,
      longer_videos: true,
    },
  };
}

/**
 * No-op debit. Returns the requested amount for diagnostics but charges 0.
 * TODO(REAL-BILLING): decrement the ledger atomically and reject when short.
 */
export async function chargeCredits(
  userId: string,
  amount: number,
  reason: string,
): Promise<{
  ok: true;
  mocked: true;
  requested: number;
  charged: 0;
  remaining: number;
  reason: string;
}> {
  void userId;
  return {
    ok: true,
    mocked: true,
    requested: amount,
    charged: 0,
    remaining: MOCK_INFINITE_CREDITS,
    reason,
  };
}

/**
 * Rough estimate of what the real product would charge.
 * NOTE: the real per-minute platform rate is not observable from the client
 * (REPORT.md section 13), so the 10-credits-per-minute baseline is an
 * inference from the published plan credit allowances. Audio-only is 10%,
 * stock avatars 3/min and custom avatars 5/min per the pricing page.
 */
export function estimateCredits(input: {
  durationSeconds: number;
  isAudioOnly?: boolean;
  avatar?: "none" | "stock" | "custom";
}): number {
  const minutes = Math.max(input.durationSeconds, 1) / 60;
  let perMinute = 10;
  if (input.isAudioOnly) perMinute *= 0.1;
  if (input.avatar === "stock") perMinute += 3;
  if (input.avatar === "custom") perMinute += 5;
  return Math.max(1, Math.ceil(perMinute * minutes));
}

/** Replaces POST /api/get-subscription-details (404 in production). */
export async function getSubscriptionDetails(userId: string) {
  const balance = await getBalance(userId);
  return {
    success: true,
    mocked: true,
    subscription: {
      status: "active",
      plan: balance.plan,
      credits_remaining: balance.credits,
      renews_at: balance.next_subscription_date,
      cancel_at_period_end: false,
      // TODO(REAL-BILLING): populate from Stripe.
      price_id: null,
      stripe_subscription_id: null,
    },
  };
}

/** Replaces GET /api/active-subscriptions (404 in production). */
export async function listActiveSubscriptions(userId: string) {
  const balance = await getBalance(userId);
  return {
    success: true,
    mocked: true,
    subscriptions: [
      {
        id: "sub_local_unlimited",
        plan: balance.plan,
        status: "active",
        quantity: 1,
        current_period_end: balance.next_subscription_date,
      },
    ],
  };
}

export type BillingIntent =
  | "create-stripe-session"
  | "plan-upgrade-checkout"
  | "plan-upgrade-complete"
  | "annual-upgrade-options"
  | "annual-upgrade-checkout"
  | "customer-portal-session"
  | "cancel-subscription"
  | "pause-subscription"
  | "resume-subscription"
  | "can-pause-subscription"
  | "remove-addon";

/**
 * Single entry point for every billing BFF route.
 *
 * TODO(REAL-BILLING): delete this function and implement each route against
 * Stripe. The shape below is intentionally boring: `{ success, mocked, ... }`.
 */
export async function mockBillingActionResult(intent: BillingIntent, body: unknown) {
  return {
    success: true,
    mocked: true,
    intent,
    message:
      "Billing is disabled in local mode. Every plan, add-on and credit top-up is unlocked for free.",
    // Local checkout "succeeds" by redirecting straight back to the app.
    url: intent.includes("checkout") || intent === "create-stripe-session"
      ? "/playground?mock_checkout=success"
      : null,
    options:
      intent === "annual-upgrade-options"
        ? { annual_discount: 0.4, plans: ["starter", "creator", "growth", "business", "scale"] }
        : null,
    received: body ?? null,
  };
}
