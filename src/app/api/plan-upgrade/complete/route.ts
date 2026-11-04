import { getUserFromRequest } from "@/lib/auth";
import { billingActionResult } from "@/lib/billing";
import { fail, json, readJson } from "@/lib/http";

/**
 * POST /api/plan-upgrade/complete
 *
 * Reconciles the local ledger with a completed checkout session, in case the
 * webhook has not arrived yet (the dashboard calls this right after the
 * redirect). Safe to call repeatedly.
 */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = await readJson<Record<string, unknown>>(request);
  const result = await billingActionResult("plan-upgrade-complete", user, body);
  return json(result, result.status ?? 200);
}
