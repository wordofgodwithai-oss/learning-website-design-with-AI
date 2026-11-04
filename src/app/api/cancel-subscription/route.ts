import { getUserFromRequest } from "@/lib/auth";
import { billingActionResult } from "@/lib/billing";
import { fail, json, readJson } from "@/lib/http";

/** POST /api/cancel-subscription — cancel at the end of the current period. */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = await readJson<Record<string, unknown>>(request);
  const result = await billingActionResult("cancel-subscription", user, body);
  return json(result, result.status ?? 200);
}
