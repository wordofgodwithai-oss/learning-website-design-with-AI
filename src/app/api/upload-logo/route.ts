import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { saveUploadedFile } from "@/lib/storage";
import { setCustomLogo } from "@/lib/repo";

/** POST /api/upload-logo — Business-tier logo stored on the user_credits row. */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");

  const form = await request.formData().catch(() => null);
  if (!form) return fail(400, "Expected multipart/form-data.");
  const file = form.get("file") ?? form.get("logo");
  if (!(file instanceof File) || file.size === 0) return fail(400, "A logo file is required.");
  if (!file.type.startsWith("image/")) {
    return fail(415, "The logo must be an image (PNG, JPG or SVG).");
  }
  if (file.size > 5 * 1024 * 1024) return fail(413, "Logos must be 5 MB or smaller.");

  const upload = await saveUploadedFile(user.id, file, 5 * 1024 * 1024);
  await setCustomLogo(user.id, upload.url);
  return json({ success: true, logo_url: upload.url, upload });
}
