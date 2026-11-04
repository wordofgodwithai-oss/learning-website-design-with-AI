import { getUserFromRequest } from "@/lib/auth";
import { getBalance } from "@/lib/billing";
import { fail, json } from "@/lib/http";
import { listOrganizations } from "@/lib/repo";

/** GET /api/organizations/credits — organization credit pools. */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const [organizations, balance] = await Promise.all([
    listOrganizations(user.id),
    getBalance(user.id),
  ]);
  return json({
    organizations: organizations.map((org) => ({
      id: org.id,
      name: org.name,
      credits: Math.floor(balance.credits / Math.max(organizations.length, 1)),
      plan: balance.plan,
      seat_count: org.seat_count,
      mocked_billing: balance.mocked,
    })),
  });
}
