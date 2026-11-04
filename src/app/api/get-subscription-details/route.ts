import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { getSubscriptionDetails } from "@/lib/billing/mock-billing";

/**
 * POST /api/get-subscription-details
 *
 * DEVIATION: in production this route 404s on every playground load
 * (REPORT.md section 12, defect 1) and the UI falls back to `user_credits`.
 * Locally it answers with mock data so the console stays clean.
 *
 * TODO(REAL-BILLING): back this with Stripe, or delete the route and rely on
 * the user_credits row like production does.
 */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  return json(await getSubscriptionDetails(user.id));
}
