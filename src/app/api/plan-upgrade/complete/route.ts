import { getUserFromRequest } from "@/lib/auth";
import { fail, json, readJson } from "@/lib/http";
import { mockBillingActionResult } from "@/lib/billing/mock-billing";

/**
 * MOCK BILLING — POST /api/complete
 *
 * TODO(REAL-BILLING): implement this against Stripe. See REPORT.md section 8
 * and src/lib/billing/mock-billing.ts.
 */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = await readJson<Record<string, unknown>>(request);
  return json(await mockBillingActionResult("plan-upgrade-complete", body));
}
