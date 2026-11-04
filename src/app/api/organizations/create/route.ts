import { getUserFromRequest } from "@/lib/auth";
import { fail, json, num, readJson, str } from "@/lib/http";
import { createOrganization } from "@/lib/repo";
import { MOCK_INFINITE_CREDITS } from "@/lib/billing/constants";

/** POST /api/organizations/create */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = await readJson<Record<string, unknown>>(request);
  const name = str(body.name).trim();
  if (!name) return fail(400, "Organization name is required.");
  const organization = await createOrganization(user.id, name, Math.max(1, Math.trunc(num(body.seat_count, 3))));
  return json({
    success: true,
    organization,
    credits: MOCK_INFINITE_CREDITS,
    mocked_billing: true,
  });
}
