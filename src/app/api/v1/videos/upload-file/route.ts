import { requireApiKey } from "@/lib/api-auth";
import { fail, json } from "@/lib/http";
import { saveUploadedFile } from "@/lib/storage";
import { MAX_UPLOAD_BYTES } from "@/lib/generation/config";

/**
 * POST /api/v1/videos/upload-file
 * Multipart upload capped at 15 MB (documented limit, REPORT.md section 7).
 */
export async function POST(request: Request) {
  const identity = await requireApiKey(request);
  if (identity instanceof Response) return identity;

  const form = await request.formData().catch(() => null);
  if (!form) return fail(400, "Expected multipart/form-data with a `file` field.");

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail(400, "A file is required.");
  if (file.size > MAX_UPLOAD_BYTES) {
    return fail(413, "File too large. The maximum upload size is 15 MB.");
  }

  try {
    const upload = await saveUploadedFile(identity.user.id, file, MAX_UPLOAD_BYTES);
    return json({
      success: true,
      file: {
        id: upload.id,
        filename: upload.filename,
        content_type: upload.content_type,
        size: upload.size,
        url: upload.url,
      },
    });
  } catch (error) {
    return fail(500, (error as Error).message);
  }
}
