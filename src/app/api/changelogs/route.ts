import { json } from "@/lib/http";
import { listChangelogs } from "@/lib/repo";

/**
 * GET /api/changelogs?page=1&page_size=3
 * Shape: `{changelogs:[{id,version,title,summary,body:{feature:[…]},released_at}]}`
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    20,
    Math.max(1, Number.parseInt(url.searchParams.get("page_size") ?? "3", 10) || 3),
  );
  return json({ changelogs: await listChangelogs(page, pageSize) });
}
