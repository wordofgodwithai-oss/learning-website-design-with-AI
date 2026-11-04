import { handleStripeWebhook } from "@/lib/billing/stripe-billing";
import { json } from "@/lib/http";

/**
 * POST /api/stripe/webhook
 *
 * Stripe's source of truth. The body is read as raw text so the signature can
 * be verified against the exact bytes Stripe signed.
 *
 * Local usage:
 *   stripe listen --forward-to localhost:3000/api/stripe/webhook
 * then put the printed `whsec_…` in STRIPE_WEBHOOK_SECRET.
 */
export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");
  const result = await handleStripeWebhook(payload, signature);
  return json(result, result.status ?? 200);
}
