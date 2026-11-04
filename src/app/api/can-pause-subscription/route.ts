import { getUserFromRequest } from "@/lib/auth";
import { fail, json, readJson } from "@/lib/http";
import { mockBillingActionResult } from "@/lib/billing/mock-billing";

/**
 * MOCK BILLING — GET /api/subscription
 *
 * TODO(REAL-BILLING): implement this against Stripe. See REPORT.md section 8
 * and src/lib/billing/mock-billing.ts.
 */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = Object.fromEntries(new URL(request.url).searchParams.entries());
  return json(await mockBillingActionResult("can-pause-subscription", body));
}
