import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { listOrganizations } from "@/lib/repo";

/** GET /api/organizations/details?id=… */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const id = new URL(request.url).searchParams.get("id");
  const organizations = await listOrganizations(user.id);
  if (id) {
    const organization = organizations.find((org) => org.id === id);
    if (!organization) return fail(404, "Organization not found.");
    return json({ success: true, organization });
  }
  return json({ success: true, organization: organizations[0] ?? null, organizations });
}
