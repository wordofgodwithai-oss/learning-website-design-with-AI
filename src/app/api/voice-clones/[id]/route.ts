import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { deleteVoiceClone } from "@/lib/repo";

/** DELETE /api/voice-clones/{id} */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const { id } = await params;
  const removed = await deleteVoiceClone(user.id, id);
  if (!removed) return fail(404, "Voice clone not found.");
  return json({ success: true });
}
