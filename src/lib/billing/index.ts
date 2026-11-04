import "server-only";

import { billingMode } from "@/lib/integrations";
import * as mock from "@/lib/billing/mock-billing";
import * as stripe from "@/lib/billing/stripe-billing";
import type {
  BillingActionResponse,
  BillingBalance,
  BillingIntent,
  ChargeResult,
} from "@/lib/billing/types";
import type { User } from "@/lib/types";

/**
 * Billing facade.
 *
 * Routes and pages import from here; `GOLPO_BILLING_MODE` decides whether the
 * mock ledger or Stripe answers. Both implementations return the same shapes,
 * so the UI never needs to know which one is active.
 */

export { estimateCredits } from "@/lib/billing/shared";
export { billingMode };
export type { BillingActionResponse, BillingBalance, BillingIntent, ChargeResult };

export function isMockBilling(): boolean {
  return billingMode !== "stripe";
}

export async function getBalance(userId: string): Promise<BillingBalance> {
  return billingMode === "stripe" ? stripe.getBalance(userId) : mock.getBalance(userId);
}

export async function chargeCredits(
  userId: string,
  amount: number,
  reason: string,
): Promise<ChargeResult> {
  return billingMode === "stripe"
    ? stripe.chargeCredits(userId, amount, reason)
    : mock.chargeCredits(userId, amount, reason);
}

export async function grantCredits(
  userId: string,
  amount: number,
  reason: string,
): Promise<ChargeResult> {
  return billingMode === "stripe"
    ? stripe.grantCredits(userId, amount, reason)
    : mock.grantCredits(userId, amount, reason);
}

export async function getSubscriptionDetails(userId: string) {
  return billingMode === "stripe"
    ? stripe.getSubscriptionDetails(userId)
    : mock.getSubscriptionDetails(userId);
}

export async function listActiveSubscriptions(userId: string) {
  return billingMode === "stripe"
    ? stripe.listActiveSubscriptions(userId)
    : mock.listActiveSubscriptions(userId);
}

/**
 * Runs a billing intent. Provider errors become a normal error envelope so the
 * route handlers can stay one-liners regardless of the active implementation.
 */
export async function billingActionResult(
  intent: BillingIntent,
  user: User,
  body: Record<string, unknown>,
): Promise<BillingActionResponse> {
  if (billingMode !== "stripe") return mock.mockBillingActionResult(intent, body);

  try {
    return await stripe.billingActionResult(intent, user, body);
  } catch (error) {
    const status =
      typeof (error as { status?: unknown }).status === "number"
        ? ((error as { status: number }).status as number)
        : 500;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[billing] ${intent} failed:`, message);
    return {
      success: false,
      mocked: false,
      intent,
      status,
      error: message,
    };
  }
}
