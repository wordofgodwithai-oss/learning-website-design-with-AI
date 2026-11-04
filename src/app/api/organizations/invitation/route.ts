import { getUserFromRequest } from "@/lib/auth";
import { fail, json, readJson, str } from "@/lib/http";

/**
 * POST /api/organizations/invitation
 * Local mode records the invite but sends no email.
 */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = await readJson<Record<string, unknown>>(request);
  const email = str(body.email).trim();
  if (!email) return fail(400, "email is required.");
  return json({
    success: true,
    message: `Invitation for ${email} recorded locally. No email was sent.`,
    mocked_email: true,
  });
}
