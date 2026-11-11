import "server-only";

import { ANNUAL_DISCOUNTS, PAYG_TIERS, PRICING_PLANS } from "@/lib/billing/constants";
import type { CreditAccount } from "@/lib/types";

/**
 * Pure billing helpers shared by the mock and Stripe implementations.
 * Nothing here talks to a provider.
 */

export const PLAN_ORDER = [
  "free",
  "starter",
  "creator",
  "growth",
  "business",
  "scale",
  "enterprise",
] as const;

/** Local mode's pseudo-plan; ranks above every real plan. */
export const LOCAL_PLAN = "local-unlimited";

export function planRank(plan: string | null | undefined): number {
  if (!plan) return 0;
  if (plan === LOCAL_PLAN) return PLAN_ORDER.length + 10;
  const index = PLAN_ORDER.indexOf(plan as (typeof PLAN_ORDER)[number]);
  return index < 0 ? 0 : index;
}

export type Plan = (typeof PRICING_PLANS)[number];

export function planById(planId: string | null | undefined): Plan | undefined {
  const normalized = (planId ?? "").trim().toLowerCase();
  return PRICING_PLANS.find((plan) => plan.id === normalized);
}

export function planCredits(planId: string | null | undefined): number {
  return planById(planId)?.creditsPerMonth ?? 0;
}

export function planName(planId: string | null | undefined): string {
  if (planId === LOCAL_PLAN) return "Local unlimited";
  return planById(planId)?.name ?? "Free";
}

/** Annual price in the plan's currency, after the published discount. */
export function annualPrice(planId: string): number | null {
  const plan = planById(planId);
  if (!plan || plan.priceMonthly === null) return null;
  const discount = ANNUAL_DISCOUNTS[planId] ?? 0;
  return Math.round(plan.priceMonthly * 12 * (1 - discount) * 100) / 100;
}

/** Price per credit for a one-off top-up, using the published tiers. */
export function paygPricePerCredit(credits: number): number {
  const tier =
    PAYG_TIERS.find((entry) => credits >= entry.min && credits <= entry.max) ??
    PAYG_TIERS[PAYG_TIERS.length - 1];
  return tier.pricePerCredit;
}

export function addonsForAccount(account: CreditAccount | undefined): Record<string, boolean> {
  if (!account) {
    return {
      watermark: false,
      lang: false,
      script: false,
      video_instruction: false,
      logo: false,
      team: false,
      api: false,
      longer_videos: false,
    };
  }
  return {
    watermark: account.watermark_add_on,
    lang: account.lang_add_on,
    script: account.script_add_on,
    video_instruction: account.video_instruction_add_on,
    logo: account.logo_add_on,
    team: account.team_add_on,
    api: account.api_add_on,
    longer_videos: account.longer_videos_add_on,
  };
}

/** Maps an add-on id (as sent by the dashboard) onto the ledger column. */
export function addonFlag(
  addon: string,
): keyof Pick<
  CreditAccount,
  | "watermark_add_on"
  | "lang_add_on"
  | "script_add_on"
  | "video_instruction_add_on"
  | "logo_add_on"
  | "team_add_on"
  | "api_add_on"
  | "longer_videos_add_on"
> | null {
  const normalized = addon.trim().toLowerCase().replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "watermark":
    case "watermark_removal":
      return "watermark_add_on";
    case "multilingual":
    case "lang":
    case "language":
      return "lang_add_on";
    case "script":
    case "script_mode":
      return "script_add_on";
    case "video_instruction":
    case "video_instructions":
      return "video_instruction_add_on";
    case "logo":
    case "logo_upload":
      return "logo_add_on";
    case "team":
    case "teams":
      return "team_add_on";
    case "api":
    case "api_access":
      return "api_add_on";
    case "longer_videos":
      return "longer_videos_add_on";
    default:
      return null;
  }
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
  /** Golpo Studio bills at 2 credits/min on top of the base platform rate. */
  engine?: string;
}): number {
  const minutes = Math.max(input.durationSeconds, 1) / 60;
  let perMinute = 10;
  if (input.engine === "golpo_studio") perMinute *= 2;
  if (input.isAudioOnly) perMinute *= 0.1;
  if (input.avatar === "stock") perMinute += 3;
  if (input.avatar === "custom") perMinute += 5;
  return Math.max(1, Math.ceil(perMinute * minutes));
}
