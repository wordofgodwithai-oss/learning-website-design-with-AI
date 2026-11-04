import { getUserFromRequest } from "@/lib/auth";
import { fail, json, readJson, str } from "@/lib/http";
import { createStyle, deleteStyle, listStyles } from "@/lib/repo";

/** GET /api/saved-styles — `{success, styles[]}`. */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  return json({ success: true, styles: await listStyles(user.id) });
}

/** POST /api/saved-styles — save a custom canvas style. */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = await readJson<Record<string, unknown>>(request);
  const name = str(body.name).trim();
  const prompt = str(body.prompt).trim();
  if (!name || !prompt) return fail(400, "name and prompt are required.");
  const style = await createStyle(user.id, {
    name,
    prompt,
    image_style: str(body.image_style) || null,
  });
  return json({ success: true, style });
}

/** DELETE /api/saved-styles?id=… */
export async function DELETE(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return fail(400, "id is required.");
  const removed = await deleteStyle(user.id, id);
  if (!removed) return fail(404, "Style not found.");
  return json({ success: true });
}
