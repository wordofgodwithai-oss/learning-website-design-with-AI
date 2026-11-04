import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { listOrganizations } from "@/lib/repo";
import { MOCK_INFINITE_CREDITS } from "@/lib/billing/constants";

/** GET /api/organizations/credits — `{organizations: []}` in production. */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const organizations = await listOrganizations(user.id);
  return json({
    organizations: organizations.map((org) => ({
      id: org.id,
      name: org.name,
      credits: MOCK_INFINITE_CREDITS,
      plan: "local-unlimited",
      seat_count: org.seat_count,
      mocked_billing: true,
    })),
  });
}
