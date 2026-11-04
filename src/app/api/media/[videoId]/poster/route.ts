import { getVideo } from "@/lib/repo";
import { renderPoster } from "@/lib/media/svg";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await params;
  const video = await getVideo(videoId);
  if (!video) return new Response("Not found", { status: 404 });

  return new Response(renderPoster(video), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}
