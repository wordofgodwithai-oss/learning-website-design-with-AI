import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { deleteCustomMusic } from "@/lib/repo";

/** DELETE /api/custom-music/{id} */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const { id } = await params;
  const removed = await deleteCustomMusic(user.id, id);
  if (!removed) return fail(404, "Track not found.");
  return json({ success: true });
}
