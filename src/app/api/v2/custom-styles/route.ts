import { requireApiKey } from "@/lib/api-auth";
import { fail, json, readJson, str } from "@/lib/http";
import { createStyle } from "@/lib/repo";

/** POST /api/v2/custom-styles — v2 body uses `description`. */
export async function POST(request: Request) {
  const identity = await requireApiKey(request);
  if (identity instanceof Response) return identity;
  const body = await readJson<Record<string, unknown>>(request);
  const name = str(body.name).trim();
  const prompt = str(body.prompt ?? body.description).trim();
  if (!name || !prompt) return fail(400, "name and description are required.");
  const style = await createStyle(identity.user.id, {
    name,
    prompt,
    image_style: str(body.image_style ?? body.canvas_style_variant) || null,
  });
  return json({ success: true, style }, 201);
}
