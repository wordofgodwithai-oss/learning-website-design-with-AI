import { getUserFromRequest } from "@/lib/auth";
import { billingActionResult } from "@/lib/billing";
import { fail, json, readJson } from "@/lib/http";

/**
 * POST /api/create-stripe-session
 *
 * Starts either a credit-pack checkout (when `credits`/`amount` is provided) or
 * a subscription checkout. Returns a Stripe-hosted URL in live mode and a
 * redirect back into the app in mock mode.
 */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = await readJson<Record<string, unknown>>(request);
  const result = await billingActionResult("create-stripe-session", user, body);
  return json(result, result.status ?? 200);
}
