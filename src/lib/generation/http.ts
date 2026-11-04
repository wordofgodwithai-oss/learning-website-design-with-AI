import "server-only";

import { fail } from "@/lib/http";
import { GenerationError, serverError } from "@/lib/generation/errors";
import { saveUploadedFile } from "@/lib/storage";

/** Converts a thrown GenerationError (or anything else) into a response. */
export function generationErrorResponse(error: unknown) {
  if (error instanceof GenerationError) {
    return fail(error.status, error.message, { code: error.code });
  }
  console.error("[generate]", error);
  const mapped = serverError();
  return fail(mapped.status, mapped.message, { code: mapped.code });
}

function appendField(fields: Record<string, unknown>, key: string, value: unknown): void {
  const existing = fields[key];
  if (existing === undefined) {
    fields[key] = value;
    return;
  }
  if (Array.isArray(existing)) {
    existing.push(value);
    return;
  }
  fields[key] = [existing, value];
}

/**
 * Reads a generate request.
 *
 * v1 is multipart (default), v2 is JSON. Uploaded files are persisted and
 * replaced by their local URLs, which is what the real route does when it
 * pushes to S3 (REPORT.md section 3).
 */
export async function readGenerationBody(
  request: Request,
  userId: string,
): Promise<{ fields: Record<string, unknown>; uploadUrls: string[] }> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    const uploadUrls = Array.isArray(body.upload_urls) ? body.upload_urls.map(String) : [];
    return { fields: body, uploadUrls };
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new GenerationError(
      400,
      "Expected multipart/form-data. Send the video parameters as form fields.",
      "invalid_content_type",
    );
  }

  const fields: Record<string, unknown> = {};
  const uploadUrls: string[] = [];

  for (const [key, value] of form.entries()) {
    if (value instanceof File) {
      if (value.size === 0) continue;
      const upload = await saveUploadedFile(userId, value);
      uploadUrls.push(upload.url);
      const target = key === "logo" ? "logo_url" : key;
      appendField(fields, target, upload.url);
      continue;
    }
    appendField(fields, key, value);
  }

  return { fields, uploadUrls };
}
