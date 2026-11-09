import "server-only";

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { getUpload } from "@/lib/repo";
import { MEDIA_DIR } from "@/lib/media/store";

/**
 * Turns the URLs stored on a video back into local file paths.
 *
 * Everything the dashboard uploads (logo, avatar, music, user images/clips,
 * own-narration webcam) is served from `/api/media/uploads/<id>`, so a render
 * can read the file straight from disk instead of downloading it over HTTP.
 * Remote https URLs are fetched once and cached.
 */

const REMOTE_DIR = path.join(MEDIA_DIR, "remote");
const MAX_REMOTE_BYTES = 40 * 1024 * 1024;

export function uploadIdFromUrl(url: string): string | null {
  const match = /^\/api\/media\/uploads\/([A-Za-z0-9-]+)/.exec(url);
  return match?.[1] ?? null;
}

async function fetchRemote(url: string): Promise<string | null> {
  const key = createHash("sha256").update(url).digest("hex").slice(0, 32);
  const extension = (() => {
    try {
      const parsed = new URL(url);
      const ext = path.extname(parsed.pathname).toLowerCase();
      return /^\.(png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|m4a|ogg|aac)$/.test(ext) ? ext : ".bin";
    } catch {
      return ".bin";
    }
  })();
  const file = path.join(REMOTE_DIR, `${key}${extension}`);

  try {
    const stat = await fs.stat(file);
    if (stat.isFile() && stat.size > 0) return file;
  } catch {
    // not cached
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (!response || !response.ok) return null;
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_REMOTE_BYTES) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_REMOTE_BYTES) return null;

  await fs.mkdir(REMOTE_DIR, { recursive: true });
  await fs.writeFile(file, bytes);
  return file;
}

export async function localAsset(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;

  if (url.startsWith("/api/media/uploads/")) {
    const id = uploadIdFromUrl(url);
    if (!id) return null;
    const upload = await getUpload(id);
    if (!upload) return null;
    try {
      const stat = await fs.stat(upload.storage_path);
      return stat.isFile() ? upload.storage_path : null;
    } catch {
      return null;
    }
  }

  if (url.startsWith("/")) {
    // Any other local route is not a file on disk.
    return null;
  }

  if (/^https?:\/\//i.test(url)) return fetchRemote(url);
  return null;
}
