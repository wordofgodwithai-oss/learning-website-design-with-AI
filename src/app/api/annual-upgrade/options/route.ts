import { getUserFromRequest } from "@/lib/auth";
import { billingActionResult } from "@/lib/billing";
import { fail, json, readJson } from "@/lib/http";

/** POST /api/annual-upgrade/options — annual pricing for each paid plan. */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = await readJson<Record<string, unknown>>(request);
  const result = await billingActionResult("annual-upgrade-options", user, body);
  return json(result, result.status ?? 200);
}
