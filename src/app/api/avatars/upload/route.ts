import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { saveUploadedFile } from "@/lib/storage";

/** POST /api/avatars/upload — stores the image and returns a local avatar. */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");

  const form = await request.formData().catch(() => null);
  if (!form) return fail(400, "Expected multipart/form-data.");
  const file = form.get("file") ?? form.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return fail(400, "An avatar image is required.");
  }
  if (!file.type.startsWith("image/")) {
    return fail(415, "Avatars must be images.");
  }
  const upload = await saveUploadedFile(user.id, file, 10 * 1024 * 1024);
  return json({
    success: true,
    avatar: {
      id: upload.id,
      name: upload.filename,
      url: upload.url,
      stylization_enabled: true,
      credits_per_minute: 5,
    },
  });
}
