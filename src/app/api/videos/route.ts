import { getUserFromRequest } from "@/lib/auth";
import { fail, json, pagination } from "@/lib/http";
import { listVideos } from "@/lib/repo";
import type { VideoFilters } from "@/lib/repo";

/** GET /api/videos — the dashboard library feed. */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const url = new URL(request.url);
  const { page, pageSize, offset } = pagination(url);

  const type = url.searchParams.get("type");
  const filters: VideoFilters = {
    search: url.searchParams.get("search") ?? undefined,
    type: type === "video" || type === "podcast" ? type : "all",
    style: url.searchParams.get("style") ?? undefined,
    language: url.searchParams.get("language") ?? undefined,
    visibility:
      (url.searchParams.get("visibility") as VideoFilters["visibility"]) ?? "all",
    limit: pageSize,
    offset,
  };

  const videos = await listVideos(user.id, filters);
  return json({ success: true, videos, page, page_size: pageSize });
}
