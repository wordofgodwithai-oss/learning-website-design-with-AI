import "server-only";

/**
 * Billing constants.
 *
 * ---------------------------------------------------------------------------
 * TODO(REAL-BILLING) — everything in this folder is a local mock.
 *
 * When this clone needs to handle money, replace src/lib/billing/mock-billing.ts
 * with the real integration described in REPORT.md section 8:
 *
 *   - Stripe.js (basil API, 2025-03-31) with the live publishable key
 *     `pk_live_51PgE9v…` (never commit the secret key).
 *   - Flows: create-stripe-session, plan-upgrade/checkout + complete,
 *     annual-upgrade/options + checkout, customer-portal-session,
 *     cancel / pause / resume subscription, remove-addon.
 *   - Credit ledger on the `user_credits` row plus the add-on flags
 *     (watermark_add_on, lang_add_on, script_add_on, video_instruction_add_on,
 *     logo_add_on, team_add_on, api_add_on, longer_videos_add_on).
 *   - Webhook handling is not observable from the client and remains unknown
 *     (REPORT.md section 13).
 * ---------------------------------------------------------------------------
 */

/** Every local account gets this balance. Never decremented in local mode. */
export const MOCK_INFINITE_CREDITS = 999_999;

/** Plan catalogue copied from the public /pricing page (REPORT.md section 8). */
export const PRICING_PLANS = [
  {
    id: "free",
    name: "Free",
    priceMonthly: 0,
    creditsPerMonth: 0,
    blurb: "One watermarked 1-minute video.",
    features: ["1 minute", "Watermark", "No download"],
  },
  {
    id: "starter",
    name: "Starter",
    priceMonthly: 39.99,
    creditsPerMonth: 20,
    blurb: "Short black-and-white explainers.",
    features: ["30 s – 2 min", "No watermark", "B&W styles", "Frame-by-frame edit"],
  },
  {
    id: "creator",
    name: "Creator",
    priceMonthly: 99.99,
    creditsPerMonth: 60,
    blurb: "Multilingual and AI presenters.",
    features: ["15 s – 2 min", "10 language variants", "Voice instructions", "AI presenter"],
  },
  {
    id: "growth",
    name: "Growth",
    priceMonthly: 199.99,
    creditsPerMonth: 150,
    blurb: "Longer, colour, custom scene selection.",
    features: ["15 s – 4 min", "Custom scene selection", "Colour", "New sketch styles"],
  },
  {
    id: "business",
    name: "Business",
    priceMonthly: 499.99,
    creditsPerMonth: 390,
    blurb: "Teams, voice cloning and your own media.",
    features: ["Up to 10 min", "Logo", "Voice cloning", "User media", "Podcast", "10 seats"],
  },
  {
    id: "scale",
    name: "Scale",
    priceMonthly: 999.99,
    creditsPerMonth: 800,
    blurb: "API access and character consistency.",
    features: ["Character consistency", "API access", "Priority support", "50 seats"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceMonthly: null,
    creditsPerMonth: null,
    blurb: "15-minute videos, white-glove onboarding.",
    features: ["15 min videos", "Custom seats", "Dedicated support"],
  },
] as const;

export const ANNUAL_DISCOUNTS: Record<string, number> = {
  starter: 0.4,
  creator: 0.4,
  growth: 0.4,
  business: 0.5,
  scale: 0.5,
};

export const PAYG_TIERS = [
  { min: 5, max: 19, pricePerCredit: 7.99 },
  { min: 20, max: 99, pricePerCredit: 5.99 },
  { min: 100, max: Number.POSITIVE_INFINITY, pricePerCredit: 3.99 },
];

export const ADDONS = {
  credits: { label: "Credits", price: null },
  multilingual: { label: "Multilingual", price: 40 },
  logo: { label: "Logo upload", price: 100 },
  video_instruction: { label: "Video instruction", price: 100 },
  longer_videos: { label: "Longer videos (8/10/15 min)", price: 200 },
  api: { label: "API access", price: 200 },
} as const;
