import { getUserFromRequest } from "@/lib/auth";
import { listActiveSubscriptions } from "@/lib/billing";
import { fail, json } from "@/lib/http";

/**
 * GET /api/active-subscriptions
 *
 * DEVIATION: 404 in production (REPORT.md section 12, defect 1). Returns the
 * subscription recorded on the local ledger.
 */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  return json(await listActiveSubscriptions(user.id));
}
