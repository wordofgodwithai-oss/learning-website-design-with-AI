/** Shared shapes for both billing implementations (mock and Stripe). */

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

export interface BillingBalance {
  user_id: string;
  credits: number;
  plan: string;
  unlimited: boolean;
  mocked: boolean;
  next_subscription_date: string | null;
  subscription_canceled: boolean;
  addons: Record<string, boolean>;
}

export interface ChargeResult {
  ok: boolean;
  mocked: boolean;
  requested: number;
  charged: number;
  remaining: number;
  reason: string;
}

export interface BillingActionResponse {
  success: boolean;
  mocked: boolean;
  intent: BillingIntent;
  message?: string;
  url?: string | null;
  options?: unknown;
  received?: unknown;
  error?: string;
  /** Optional HTTP status when the action failed. */
  status?: number;
  [key: string]: unknown;
}
