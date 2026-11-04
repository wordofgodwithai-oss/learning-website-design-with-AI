import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";

import { getVideo } from "@/lib/repo";
import { renderPreview } from "@/lib/media/svg";
import { resolveMediaFile } from "@/lib/media/store";

/**
 * Serves the finished asset for a video.
 *
 * A real FFmpeg render is streamed as MP4 with byte-range support (needed for
 * seeking). Videos rendered before the renderer existed, or jobs that fell back
 * to the storyboard, still get the animated SVG.
 */

function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await params;
  const video = await getVideo(videoId);
  if (!video) return new Response("Not found", { status: 404 });

  const file = await resolveMediaFile("video", video.id, video.variant_of);
  if (file) {
    const stat = await fs.stat(file);
    const rangeHeader = request.headers.get("range");

    if (rangeHeader) {
      const range = parseRange(rangeHeader, stat.size);
      if (!range) {
        return new Response("Range not satisfiable", {
          status: 416,
          headers: { "content-range": `bytes */${stat.size}` },
        });
      }
      const stream = createReadStream(file, { start: range.start, end: range.end });
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-length": String(range.end - range.start + 1),
          "content-range": `bytes ${range.start}-${range.end}/${stat.size}`,
          "accept-ranges": "bytes",
          "cache-control": "no-store",
        },
      });
    }

    const stream = createReadStream(file);
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      headers: {
        "content-type": "video/mp4",
        "content-length": String(stat.size),
        "accept-ranges": "bytes",
        "cache-control": "no-store",
      },
    });
  }

  return new Response(renderPreview(video), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
