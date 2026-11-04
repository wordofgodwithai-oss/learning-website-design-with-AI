import { requireApiKey } from "@/lib/api-auth";
import { json, pagination } from "@/lib/http";
import { listVideos } from "@/lib/repo";

/** GET /api/v1/videos — paginated list for the API tier. */
export async function GET(request: Request) {
  const identity = await requireApiKey(request);
  if (identity instanceof Response) return identity;

  const url = new URL(request.url);
  const { page, pageSize, offset } = pagination(url);
  const type = url.searchParams.get("type");
  const videos = await listVideos(identity.user.id, {
    search: url.searchParams.get("search") ?? undefined,
    type: type === "video" || type === "podcast" ? type : "all",
    visibility: (url.searchParams.get("visibility") as "all" | "private" | "public" | "unlisted") ?? "all",
    limit: pageSize,
    offset,
  });

  return json({
    success: true,
    videos,
    page,
    page_size: pageSize,
    has_more: videos.length === pageSize,
  });
}
