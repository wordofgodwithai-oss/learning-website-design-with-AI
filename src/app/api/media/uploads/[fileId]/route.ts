import { promises as fs } from "node:fs";

import { getUpload } from "@/lib/repo";

/** GET /api/media/uploads/{id} — serves a locally stored upload. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params;
  const upload = await getUpload(fileId);
  if (!upload) return new Response("Not found", { status: 404 });

  try {
    const bytes = await fs.readFile(upload.storage_path);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": upload.content_type,
        "content-length": String(upload.size),
        "cache-control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("File missing from disk", { status: 410 });
  }
}
