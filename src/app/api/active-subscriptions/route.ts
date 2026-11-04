import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { listActiveSubscriptions } from "@/lib/billing/mock-billing";

/**
 * GET /api/active-subscriptions
 *
 * DEVIATION: 404 in production (REPORT.md section 12, defect 1). Returns mock
 * subscription data locally.
 *
 * TODO(REAL-BILLING): query Stripe subscriptions for the customer.
 */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  return json(await listActiveSubscriptions(user.id));
}
