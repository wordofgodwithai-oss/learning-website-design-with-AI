import { promises as fs } from "node:fs";

import { getVideo } from "@/lib/repo";
import { renderPoster } from "@/lib/media/svg";
import { resolveMediaFile } from "@/lib/media/store";

/**
 * Poster image. A real render produces a JPEG via sharp; older/storyboard
 * videos fall back to the SVG poster.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await params;
  const video = await getVideo(videoId);
  if (!video) return new Response("Not found", { status: 404 });

  const file = await resolveMediaFile("poster", video.id, video.variant_of);
  if (file) {
    const bytes = await fs.readFile(file);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(bytes.byteLength),
        "cache-control": "no-store",
      },
    });
  }

  return new Response(renderPoster(video), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
