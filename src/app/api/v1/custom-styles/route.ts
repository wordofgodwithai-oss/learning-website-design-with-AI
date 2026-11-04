import { requireApiKey } from "@/lib/api-auth";
import { fail, json, readJson, str } from "@/lib/http";
import { createStyle, listStyles } from "@/lib/repo";

/** GET /api/v1/custom-styles */
export async function GET(request: Request) {
  const identity = await requireApiKey(request);
  if (identity instanceof Response) return identity;
  return json({ success: true, styles: await listStyles(identity.user.id) });
}

/** POST /api/v1/custom-styles */
export async function POST(request: Request) {
  const identity = await requireApiKey(request);
  if (identity instanceof Response) return identity;
  const body = await readJson<Record<string, unknown>>(request);
  const name = str(body.name).trim();
  const prompt = str(body.prompt).trim();
  if (!name || !prompt) return fail(400, "name and prompt are required.");
  const style = await createStyle(identity.user.id, {
    name,
    prompt,
    image_style: str(body.image_style) || null,
  });
  return json({ success: true, style }, 201);
}
