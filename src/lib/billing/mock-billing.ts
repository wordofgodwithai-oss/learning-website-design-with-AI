import "server-only";

import { getCreditAccount } from "@/lib/repo";
import { MOCK_INFINITE_CREDITS } from "@/lib/billing/constants";
import { addonsForAccount, estimateCredits } from "@/lib/billing/shared";
import type {
  BillingActionResponse,
  BillingBalance,
  BillingIntent,
  ChargeResult,
} from "@/lib/billing/types";

/**
 * ===========================================================================
 * MOCK BILLING — used when GOLPO_BILLING_MODE resolves to `mock`
 * (the default without STRIPE_SECRET_KEY).
 *
 * Balances are always MOCK_INFINITE_CREDITS and nothing is ever charged.
 * Every function returns a `mocked: true` marker so a local response can never
 * be mistaken for a real Stripe result.
 * ===========================================================================
 */

export type LocalBalance = BillingBalance;

export async function getBalance(userId: string): Promise<BillingBalance> {
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
      ...addonsForAccount(account),
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

/** No-op debit. Returns the requested amount for diagnostics but charges 0. */
export async function chargeCredits(
  userId: string,
  amount: number,
  reason: string,
): Promise<ChargeResult> {
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

/** No-op refund/credit grant. */
export async function grantCredits(
  userId: string,
  amount: number,
  reason: string,
): Promise<ChargeResult> {
  void userId;
  return {
    ok: true,
    mocked: true,
    requested: amount,
    charged: -amount,
    remaining: MOCK_INFINITE_CREDITS,
    reason,
  };
}

export { estimateCredits };

/** Replaces POST /api/get-subscription-details (404 in production). */
export async function getSubscriptionDetails(userId: string) {
  const balance = await getBalance(userId);
  const account = await getCreditAccount(userId);
  return {
    success: true,
    mocked: true,
    subscription: {
      status: "active",
      plan: balance.plan,
      credits_remaining: balance.credits,
      renews_at: balance.next_subscription_date,
      cancel_at_period_end: false,
      price_id: account?.price_id ?? null,
      stripe_subscription_id: account?.stripe_subscription_id ?? null,
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

/**
 * Single entry point for every billing BFF route in mock mode.
 * Local checkout "succeeds" by redirecting straight back to the app.
 */
export async function mockBillingActionResult(
  intent: BillingIntent,
  body: unknown,
): Promise<BillingActionResponse> {
  return {
    success: true,
    mocked: true,
    intent,
    message:
      "Billing is disabled in local mode. Every plan, add-on and credit top-up is unlocked for free.",
    url:
      intent.includes("checkout") || intent === "create-stripe-session"
        ? "/playground?mock_checkout=success"
        : null,
    options:
      intent === "annual-upgrade-options"
        ? { annual_discount: 0.4, plans: ["starter", "creator", "growth", "business", "scale"] }
        : null,
    received: body ?? null,
  };
}
