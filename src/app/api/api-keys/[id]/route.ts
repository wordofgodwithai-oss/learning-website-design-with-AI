import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { revokeApiKey } from "@/lib/repo";

/** DELETE /api/api-keys/{id} */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const { id } = await params;
  const revoked = await revokeApiKey(user.id, id);
  if (!revoked) return fail(404, "API key not found.");
  return json({ success: true, revoked: true });
}
