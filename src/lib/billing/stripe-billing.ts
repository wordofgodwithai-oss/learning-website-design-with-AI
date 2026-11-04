import "server-only";

import Stripe from "stripe";

import {
  APP_URL,
  STRIPE_CURRENCY,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  unlimitedDevOverride,
} from "@/lib/integrations";
import { MOCK_INFINITE_CREDITS } from "@/lib/billing/constants";
import {
  addonFlag,
  addonsForAccount,
  annualPrice,
  estimateCredits,
  paygPricePerCredit,
  planById,
  planCredits,
} from "@/lib/billing/shared";
import type {
  BillingActionResponse,
  BillingBalance,
  BillingIntent,
  ChargeResult,
} from "@/lib/billing/types";
import {
  addCredits,
  getCreditAccount,
  getUserByStripeCustomer,
  hasBillingEvent,
  recordBillingEvent,
  spendCredits,
  updateCreditAccount,
} from "@/lib/repo";
import type { CreditAccount, User } from "@/lib/types";

/**
 * ===========================================================================
 * STRIPE BILLING — used when GOLPO_BILLING_MODE resolves to `stripe`
 * (automatic once STRIPE_SECRET_KEY is present).
 *
 * Design notes:
 *  - Plans use inline `price_data`, so no dashboard product/price setup is
 *    needed. The plan id and interval travel in checkout/subscription metadata.
 *  - The local `user_credits` row is the ledger. Stripe is the source of truth
 *    for subscription state; webhooks reconcile it.
 *  - Credits are reset to the plan allowance when a subscription is created or
 *    an invoice is paid, and decremented per generation.
 *  - Webhook events are de-duplicated through `billing_events`.
 * ===========================================================================
 */

class BillingError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "BillingError";
    this.status = status;
  }
}

let client: Stripe | null = null;

function stripe(): Stripe {
  if (!STRIPE_SECRET_KEY) {
    throw new BillingError("STRIPE_SECRET_KEY is not configured.", 503);
  }
  client ??= new Stripe(STRIPE_SECRET_KEY);
  return client;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export async function getBalance(userId: string): Promise<BillingBalance> {
  const account = await getCreditAccount(userId);
  if (unlimitedDevOverride) {
    return {
      user_id: userId,
      credits: MOCK_INFINITE_CREDITS,
      plan: "local-unlimited",
      unlimited: true,
      mocked: false,
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
  return {
    user_id: userId,
    credits: account?.credits ?? 0,
    plan: account?.plan ?? "free",
    unlimited: false,
    mocked: false,
    next_subscription_date: account?.next_subscription_date ?? null,
    subscription_canceled: account?.subscription_canceled ?? false,
    addons: addonsForAccount(account),
  };
}

export async function chargeCredits(
  userId: string,
  amount: number,
  reason: string,
): Promise<ChargeResult> {
  if (unlimitedDevOverride) {
    return {
      ok: true,
      mocked: false,
      requested: amount,
      charged: 0,
      remaining: MOCK_INFINITE_CREDITS,
      reason,
    };
  }
  const result = await spendCredits(userId, amount);
  return {
    ok: result.ok,
    mocked: false,
    requested: amount,
    charged: result.charged,
    remaining: result.remaining,
    reason,
  };
}

export async function grantCredits(
  userId: string,
  amount: number,
  reason: string,
): Promise<ChargeResult> {
  if (unlimitedDevOverride) {
    return {
      ok: true,
      mocked: false,
      requested: amount,
      charged: -amount,
      remaining: MOCK_INFINITE_CREDITS,
      reason,
    };
  }
  const result = await addCredits(userId, amount);
  return {
    ok: result.ok,
    mocked: false,
    requested: amount,
    charged: -amount,
    remaining: result.remaining,
    reason,
  };
}

export { estimateCredits };

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export async function getSubscriptionDetails(userId: string) {
  const account = await getCreditAccount(userId);
  return {
    success: true,
    mocked: false,
    subscription: {
      status: account?.subscription_status ?? (account?.plan === "free" ? "none" : "active"),
      plan: account?.plan ?? "free",
      credits_remaining: account?.credits ?? 0,
      renews_at: account?.next_subscription_date ?? null,
      cancel_at_period_end: account?.cancel_at_period_end ?? false,
      price_id: account?.price_id ?? null,
      stripe_subscription_id: account?.stripe_subscription_id ?? null,
      paused: account?.subscription_paused ?? false,
    },
  };
}

export async function listActiveSubscriptions(userId: string) {
  const account = await getCreditAccount(userId);
  const subscriptions =
    account?.stripe_subscription_id && account.plan !== "free"
      ? [
          {
            id: account.stripe_subscription_id,
            plan: account.plan,
            status: account.subscription_status ?? "active",
            quantity: 1,
            current_period_end: account.current_period_end ?? null,
            cancel_at_period_end: account.cancel_at_period_end ?? false,
          },
        ]
      : [];
  return { success: true, mocked: false, subscriptions };
}

// ---------------------------------------------------------------------------
// Checkout / portal
// ---------------------------------------------------------------------------

function customerIdOf(
  value: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if ("deleted" in value && value.deleted) return null;
  return value.id;
}

async function getOrCreateCustomer(user: User): Promise<string> {
  const account = await getCreditAccount(user.id);
  if (account?.stripe_customer_id) return account.stripe_customer_id;

  const customer = await stripe().customers.create(
    {
      email: user.email,
      name: user.name,
      metadata: { user_id: user.id },
    },
    { idempotencyKey: `golpo_customer_${user.id}` },
  );
  await updateCreditAccount(user.id, {
    stripe_customer_id: customer.id,
    stripe_email: user.email,
  });
  return customer.id;
}

function appUrl(path: string): string {
  return `${APP_URL.replace(/\/+$/, "")}${path}`;
}

function planForRequest(body: Record<string, unknown>): {
  planId: string;
  interval: "month" | "year";
} {
  const planId = String(body.plan ?? body.plan_id ?? body.tier ?? "creator")
    .trim()
    .toLowerCase();
  const plan = planById(planId);
  if (!plan || plan.priceMonthly === null) {
    throw new BillingError(
      `The "${planId}" plan is not available for self-serve checkout.`,
    );
  }
  const wantsAnnual =
    body.annual === true ||
    body.annual === "true" ||
    String(body.interval ?? body.billing_interval ?? "").toLowerCase() === "year";
  return { planId, interval: wantsAnnual ? "year" : "month" };
}

async function createSubscriptionCheckout(
  user: User,
  body: Record<string, unknown>,
  intent: BillingIntent,
): Promise<BillingActionResponse> {
  const { planId, interval } = planForRequest(body);
  const plan = planById(planId);
  if (!plan || plan.priceMonthly === null) {
    throw new BillingError(`Unknown plan: ${planId}`);
  }

  const customer = await getOrCreateCustomer(user);
  const annual = interval === "year";
  const unitAmount = annual
    ? Math.round((annualPrice(planId) ?? plan.priceMonthly * 12) * 100)
    : Math.round(plan.priceMonthly * 100);

  const metadata = { user_id: user.id, plan: planId, interval };

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: STRIPE_CURRENCY,
          unit_amount: unitAmount,
          recurring: { interval },
          product_data: {
            name: `Golpo ${plan.name}${annual ? " (annual)" : ""}`,
            description: `${plan.creditsPerMonth ?? 0} credits per month`,
          },
        },
      },
    ],
    metadata,
    subscription_data: { metadata },
    allow_promotion_codes: true,
    success_url: appUrl("/playground?checkout=success&session_id={CHECKOUT_SESSION_ID}"),
    cancel_url: appUrl("/pricing?checkout=cancelled"),
  });

  return {
    success: true,
    mocked: false,
    intent,
    plan: planId,
    interval,
    session_id: session.id,
    url: session.url,
    message: "Redirecting to Stripe Checkout.",
  };
}

async function createCreditCheckout(
  user: User,
  body: Record<string, unknown>,
): Promise<BillingActionResponse> {
  const requested = Number(body.credits ?? body.amount ?? 0);
  if (!Number.isFinite(requested) || requested < 5) {
    throw new BillingError("Choose at least 5 credits to buy.");
  }
  const credits = Math.min(Math.floor(requested), 100_000);
  const unitAmount = Math.round(credits * paygPricePerCredit(credits) * 100);
  const customer = await getOrCreateCustomer(user);

  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer,
    client_reference_id: user.id,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: STRIPE_CURRENCY,
          unit_amount: unitAmount,
          product_data: { name: `${credits} Golpo credits` },
        },
      },
    ],
    metadata: { user_id: user.id, kind: "credits", credits: String(credits) },
    success_url: appUrl("/playground?checkout=success&session_id={CHECKOUT_SESSION_ID}"),
    cancel_url: appUrl("/pricing?checkout=cancelled"),
  });

  return {
    success: true,
    mocked: false,
    intent: "create-stripe-session",
    credits,
    session_id: session.id,
    url: session.url,
  };
}

// ---------------------------------------------------------------------------
// Subscription state
// ---------------------------------------------------------------------------

function subscriptionPlan(subscription: Stripe.Subscription): string {
  const fromMetadata = subscription.metadata?.plan;
  if (fromMetadata && planById(fromMetadata)) return fromMetadata;
  return subscription.status === "canceled" ? "free" : "free";
}

function periodEnd(subscription: Stripe.Subscription): string | null {
  const seconds = subscription.items.data[0]?.current_period_end;
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

async function applySubscription(
  userId: string,
  subscription: Stripe.Subscription,
  options: { grant?: boolean } = {},
): Promise<void> {
  const plan = subscriptionPlan(subscription);
  const renewsAt = periodEnd(subscription);
  const patch: Partial<CreditAccount> = {
    stripe_customer_id: customerIdOf(subscription.customer),
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
    subscription_paused: Boolean(subscription.pause_collection),
    cancel_at_period_end: subscription.cancel_at_period_end,
    current_period_end: renewsAt,
    next_subscription_date: renewsAt,
    subscription_canceled: subscription.status === "canceled",
    plan,
  };
  if (options.grant) patch.credits = planCredits(plan);
  await updateCreditAccount(userId, patch);
}

function subscriptionUserId(subscription: Stripe.Subscription): string | null {
  const metadataUser = subscription.metadata?.user_id;
  return typeof metadataUser === "string" && metadataUser ? metadataUser : null;
}

async function processCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.user_id || session.client_reference_id;
  if (!userId) return;

  const customer = customerIdOf(session.customer);
  if (customer) await updateCreditAccount(userId, { stripe_customer_id: customer });

  if (session.mode === "subscription") {
    const subscription = session.subscription;
    const resolved =
      subscription && typeof subscription !== "string"
        ? subscription
        : subscription
          ? await stripe().subscriptions.retrieve(subscription)
          : null;
    if (resolved) await applySubscription(userId, resolved, { grant: true });
    return;
  }

  const credits = Number(session.metadata?.credits ?? 0);
  if (Number.isFinite(credits) && credits > 0) {
    await addCredits(userId, Math.floor(credits));
  }
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const fromParent = invoice.parent?.subscription_details?.subscription;
  const legacy = (invoice as unknown as { subscription?: string | Stripe.Subscription })
    .subscription;
  const value = fromParent ?? legacy;
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

async function processInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;
  const subscription = await stripe().subscriptions.retrieve(subscriptionId);
  const userId =
    subscriptionUserId(subscription) ??
    (customerIdOf(subscription.customer)
      ? (await getUserByStripeCustomer(customerIdOf(subscription.customer) as string))?.id
      : undefined);
  if (!userId) return;
  // A paid invoice starts a new billing period: reset to the plan allowance.
  await applySubscription(userId, subscription, { grant: true });
}

async function processSubscriptionEvent(subscription: Stripe.Subscription): Promise<void> {
  const customer = customerIdOf(subscription.customer);
  const userId =
    subscriptionUserId(subscription) ??
    (customer ? (await getUserByStripeCustomer(customer))?.id : undefined);
  if (!userId) return;
  await applySubscription(userId, subscription);
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

export interface WebhookResult {
  received: boolean;
  duplicate?: boolean;
  error?: string;
  status?: number;
}

export async function handleStripeWebhook(
  payload: string,
  signature: string | null,
): Promise<WebhookResult> {
  if (!STRIPE_WEBHOOK_SECRET) {
    return {
      received: false,
      status: 503,
      error:
        "STRIPE_WEBHOOK_SECRET is not configured. Run `stripe listen --forward-to localhost:3000/api/stripe/webhook` and copy the signing secret.",
    };
  }
  if (!signature) {
    return { received: false, status: 400, error: "Missing stripe-signature header." };
  }

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    return {
      received: false,
      status: 400,
      error: `Webhook signature verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (await hasBillingEvent(event.id)) {
    return { received: true, duplicate: true };
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await processCheckoutSession(event.data.object);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await processSubscriptionEvent(event.data.object);
        break;
      case "invoice.paid":
        await processInvoicePaid(event.data.object);
        break;
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const subscriptionId = invoiceSubscriptionId(invoice);
        if (subscriptionId) {
          const subscription = await stripe().subscriptions.retrieve(subscriptionId);
          const userId =
            subscriptionUserId(subscription) ??
            (customerIdOf(subscription.customer)
              ? (await getUserByStripeCustomer(customerIdOf(subscription.customer) as string))?.id
              : undefined);
          if (userId) {
            await updateCreditAccount(userId, { subscription_status: "past_due" });
          }
        }
        break;
      }
      default:
        break;
    }
    await recordBillingEvent({ id: event.id, type: event.type });
    return { received: true };
  } catch (error) {
    console.error("[stripe] webhook processing failed", event.type, error);
    return {
      received: false,
      status: 500,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Route intents
// ---------------------------------------------------------------------------

async function requireSubscription(userId: string): Promise<CreditAccount & { stripe_subscription_id: string }> {
  const account = await getCreditAccount(userId);
  if (!account?.stripe_subscription_id) {
    throw new BillingError("This account does not have a Stripe subscription.", 404);
  }
  return account as CreditAccount & { stripe_subscription_id: string };
}

export async function billingActionResult(
  intent: BillingIntent,
  user: User,
  body: Record<string, unknown>,
): Promise<BillingActionResponse> {
  switch (intent) {
    case "create-stripe-session": {
      if (body.credits !== undefined || body.amount !== undefined) {
        return createCreditCheckout(user, body);
      }
      return createSubscriptionCheckout(user, body, intent);
    }
    case "plan-upgrade-checkout":
    case "annual-upgrade-checkout":
      return createSubscriptionCheckout(
        user,
        intent === "annual-upgrade-checkout" ? { ...body, interval: "year" } : body,
        intent,
      );

    case "plan-upgrade-complete": {
      const sessionId = String(body.session_id ?? body.sessionId ?? "").trim();
      if (sessionId) {
        const session = await stripe().checkout.sessions.retrieve(sessionId, {
          expand: ["subscription"],
        });
        if (session.status === "complete") await processCheckoutSession(session);
      }
      const balance = await getBalance(user.id);
      return {
        success: true,
        mocked: false,
        intent,
        plan: balance.plan,
        credits: balance.credits,
        message: "Checkout completed.",
      };
    }

    case "annual-upgrade-options": {
      const plans = ["starter", "creator", "growth", "business", "scale"]
        .map((id) => {
          const plan = planById(id);
          if (!plan) return null;
          return {
            id,
            name: plan.name,
            monthly: plan.priceMonthly,
            annual: annualPrice(id),
            credits_per_month: plan.creditsPerMonth,
          };
        })
        .filter(Boolean);
      return { success: true, mocked: false, intent, options: { plans } };
    }

    case "customer-portal-session": {
      const customer = await getOrCreateCustomer(user);
      const session = await stripe().billingPortal.sessions.create({
        customer,
        return_url: appUrl("/playground?portal=return"),
      });
      return { success: true, mocked: false, intent, url: session.url };
    }

    case "cancel-subscription": {
      const account = await requireSubscription(user.id);
      const subscription = await stripe().subscriptions.update(
        account.stripe_subscription_id,
        { cancel_at_period_end: true },
      );
      await applySubscription(user.id, subscription);
      return {
        success: true,
        mocked: false,
        intent,
        message: "The subscription will end at the close of the current period.",
        cancel_at_period_end: true,
      };
    }

    case "pause-subscription": {
      const account = await requireSubscription(user.id);
      const subscription = await stripe().subscriptions.update(
        account.stripe_subscription_id,
        { pause_collection: { behavior: "void" } },
      );
      await applySubscription(user.id, subscription);
      return {
        success: true,
        mocked: false,
        intent,
        message: "Payments are paused until you resume.",
      };
    }

    case "resume-subscription": {
      const account = await requireSubscription(user.id);
      const subscription = await stripe().subscriptions.update(
        account.stripe_subscription_id,
        { pause_collection: "" },
      );
      await applySubscription(user.id, subscription);
      return {
        success: true,
        mocked: false,
        intent,
        message: "Payments have resumed.",
      };
    }

    case "can-pause-subscription": {
      const account = await getCreditAccount(user.id);
      const canPause =
        Boolean(account?.stripe_subscription_id) &&
        !account?.subscription_paused &&
        account?.subscription_status !== "canceled";
      return {
        success: true,
        mocked: false,
        intent,
        can_pause: canPause,
        reason: canPause
          ? null
          : account?.subscription_paused
            ? "The subscription is already paused."
            : "Only an active paid subscription can be paused.",
      };
    }

    case "remove-addon": {
      const addon = String(body.addon ?? body.addon_id ?? body.type ?? "").trim();
      const flag = addon ? addonFlag(addon) : null;
      if (!flag) throw new BillingError("Unknown add-on.", 400);
      await updateCreditAccount(user.id, { [flag]: false } as Partial<CreditAccount>);
      return {
        success: true,
        mocked: false,
        intent,
        message: "The add-on was removed.",
        addon,
      };
    }

    default:
      throw new BillingError(`Unsupported billing intent: ${intent}`, 400);
  }
}
