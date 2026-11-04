import { getUserFromRequest } from "@/lib/auth";
import { fail, json, num, readJson, str } from "@/lib/http";
import { createVoiceClone } from "@/lib/repo";
import { saveUploadedFile } from "@/lib/storage";

/**
 * POST /api/clone-voice
 *
 * Accepts either JSON `{name, language}` for a stub clone, or multipart with
 * one or more `samples` files. The real service trains on the samples
 * asynchronously; locally the clone is immediately `ready`.
 */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await readJson<Record<string, unknown>>(request);
    const name = str(body.name).trim();
    if (!name) return fail(400, "A voice name is required.");
    const clone = await createVoiceClone(user.id, {
      name,
      language: str(body.language, "en"),
      sample_count: Math.max(1, Math.trunc(num(body.sample_count, 1))),
    });
    return json({ success: true, voice_clone: clone });
  }

  const form = await request.formData();
  const name = str(form.get("name")).trim() || "My voice";
  const samples = form.getAll("samples").filter((entry): entry is File => entry instanceof File);
  if (samples.length === 0) return fail(400, "Upload at least one audio sample.");
  for (const sample of samples) {
    if (sample.size > 15 * 1024 * 1024) return fail(413, "Each sample must be 15 MB or smaller.");
    await saveUploadedFile(user.id, sample);
  }
  const clone = await createVoiceClone(user.id, {
    name,
    language: str(form.get("language"), "en"),
    sample_count: samples.length,
  });
  return json({ success: true, voice_clone: clone });
}
