import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { saveUploadedFile } from "@/lib/storage";

/**
 * POST /api/upload-generation-files
 * Reference media for a generation (images, video clips, audio). The URLs are
 * fed back into the multipart generate request as media_files / user_images /
 * user_videos, exactly like the real client.
 */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");

  const form = await request.formData().catch(() => null);
  if (!form) return fail(400, "Expected multipart/form-data.");

  const files = [...form.entries()]
    .map(([, value]) => value)
    .filter((value): value is File => value instanceof File && value.size > 0);

  if (files.length === 0) return fail(400, "No files were uploaded.");

  const uploads = [];
  for (const file of files) {
    if (file.size > 15 * 1024 * 1024) {
      return fail(413, `${file.name} is larger than 15 MB.`);
    }
    uploads.push(await saveUploadedFile(user.id, file));
  }

  return json({
    success: true,
    uploads,
    urls: uploads.map((upload) => upload.url),
  });
}
