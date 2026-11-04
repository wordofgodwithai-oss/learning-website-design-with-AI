import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import { uuid } from "@/lib/ids";
import { MAX_UPLOAD_BYTES } from "@/lib/generation/config";
import { createUploadRecord } from "@/lib/repo";
import type { Upload } from "@/lib/types";

const DATA_DIR = process.env.GOLPO_DATA_DIR
  ? path.resolve(process.env.GOLPO_DATA_DIR)
  : path.join(process.cwd(), ".data");

export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

function safeName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return base || "upload.bin";
}

/**
 * Persists an uploaded file under .data/uploads and records it in the store.
 * The real app writes to the golpo-media S3 bucket (REPORT.md section 3); this
 * keeps the same URL/record shape so the UI does not care.
 *
 * TODO(REAL-STORAGE): swap the fs write for a presigned S3 put and store the
 * object key instead of `storage_path`.
 */
export async function saveUploadedBytes(input: {
  userId: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
  maxBytes?: number;
}): Promise<Upload> {
  const limit = input.maxBytes ?? MAX_UPLOAD_BYTES;
  if (input.bytes.byteLength > limit) {
    throw new Error(`File too large. The maximum upload size is ${Math.round(limit / 1024 / 1024)} MB.`);
  }
  const id = uuid();
  const filename = safeName(input.filename);
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const storagePath = path.join(UPLOAD_DIR, `${id}-${filename}`);
  await fs.writeFile(storagePath, input.bytes);

  return createUploadRecord({
    id,
    user_id: input.userId,
    filename,
    content_type: input.contentType || "application/octet-stream",
    size: input.bytes.byteLength,
    storage_path: storagePath,
    url: `/api/media/uploads/${id}`,
    created_at: new Date().toISOString(),
  });
}

export async function saveUploadedFile(
  userId: string,
  file: File,
  maxBytes?: number,
): Promise<Upload> {
  const bytes = Buffer.from(await file.arrayBuffer());
  return saveUploadedBytes({
    userId,
    filename: file.name || "upload.bin",
    contentType: file.type || "application/octet-stream",
    bytes,
    maxBytes,
  });
}

export function uploadFilePath(upload: Upload): string {
  return upload.storage_path;
}
