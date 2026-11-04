import { getUserFromRequest } from "@/lib/auth";
import { fail, json, num, readJson, str } from "@/lib/http";
import { createCustomMusic } from "@/lib/repo";
import { saveUploadedFile } from "@/lib/storage";

/** POST /api/upload-custom-music — multipart file or JSON `{name, url}`. */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await readJson<Record<string, unknown>>(request);
    const url = str(body.url);
    if (!url) return fail(400, "url is required.");
    const track = await createCustomMusic(user.id, {
      name: str(body.name) || url.split("/").pop() || "Custom track",
      url,
      duration_seconds: num(body.duration_seconds, 0),
    });
    return json({ success: true, custom_music: track });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail(400, "A music file is required.");
  if (file.size > 25 * 1024 * 1024) return fail(413, "Music files must be 25 MB or smaller.");
  const upload = await saveUploadedFile(user.id, file, 25 * 1024 * 1024);
  const track = await createCustomMusic(user.id, {
    name: str(form.get("name")) || file.name,
    url: upload.url,
    duration_seconds: num(form.get("duration_seconds"), 0),
  });
  return json({ success: true, custom_music: track });
}
