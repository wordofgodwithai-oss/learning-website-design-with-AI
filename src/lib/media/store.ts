import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Where rendered media lives.
 *
 * `.data/media/<videoId>.mp4` + `<videoId>.jpg`. Keeping it on disk (instead of
 * a vendor URL) means the preview/poster routes behave identically whether the
 * pipeline produced a real render or the SVG storyboard fallback.
 */

const DATA_DIR = process.env.GOLPO_DATA_DIR
  ? path.resolve(process.env.GOLPO_DATA_DIR)
  : path.join(process.cwd(), ".data");

export const MEDIA_DIR = path.join(DATA_DIR, "media");

export function videoFilePath(videoId: string): string {
  return path.join(MEDIA_DIR, `${videoId}.mp4`);
}

export function posterFilePath(videoId: string): string {
  return path.join(MEDIA_DIR, `${videoId}.jpg`);
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * A variant may not have its own render (the pipeline clones the parent), so
 * media lookups walk one level up through `variant_of`.
 */
export async function resolveMediaFile(
  kind: "video" | "poster",
  videoId: string,
  variantOf?: string | null,
): Promise<string | null> {
  const direct = kind === "video" ? videoFilePath(videoId) : posterFilePath(videoId);
  if (await fileExists(direct)) return direct;
  if (variantOf && variantOf !== videoId) {
    const parent = kind === "video" ? videoFilePath(variantOf) : posterFilePath(variantOf);
    if (await fileExists(parent)) return parent;
  }
  return null;
}

export async function removeMedia(videoId: string): Promise<void> {
  await Promise.all([
    fs.rm(videoFilePath(videoId), { force: true }),
    fs.rm(posterFilePath(videoId), { force: true }),
  ]);
}
