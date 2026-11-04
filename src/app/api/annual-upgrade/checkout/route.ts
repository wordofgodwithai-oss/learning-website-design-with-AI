import { getUserFromRequest } from "@/lib/auth";
import { billingActionResult } from "@/lib/billing";
import { fail, json, readJson } from "@/lib/http";

/** POST /api/annual-upgrade/checkout — annual variant of plan checkout. */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = await readJson<Record<string, unknown>>(request);
  const result = await billingActionResult("annual-upgrade-checkout", user, body);
  return json(result, result.status ?? 200);
}
