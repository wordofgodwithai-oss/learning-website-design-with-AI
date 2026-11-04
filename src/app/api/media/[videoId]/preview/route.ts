import { getVideo } from "@/lib/repo";
import { renderPreview } from "@/lib/media/svg";

/**
 * Simulated video playback. See src/lib/media/svg.ts — this is the seam where
 * a real MP4 URL should be served or redirected to.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await params;
  const video = await getVideo(videoId);
  if (!video) return new Response("Not found", { status: 404 });

  return new Response(renderPreview(video), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
