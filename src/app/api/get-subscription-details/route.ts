import { getUserFromRequest } from "@/lib/auth";
import { getSubscriptionDetails } from "@/lib/billing";
import { fail, json } from "@/lib/http";

/**
 * POST /api/get-subscription-details
 *
 * DEVIATION: in production this route 404s on every playground load
 * (REPORT.md section 12, defect 1) and the UI falls back to `user_credits`.
 * Locally it answers with the ledger row so the console stays clean.
 */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  return json(await getSubscriptionDetails(user.id));
}
