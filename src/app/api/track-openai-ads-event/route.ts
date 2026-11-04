import { getUserFromRequest } from "@/lib/auth";
import { fail, json, readJson, str } from "@/lib/http";

/**
 * POST /api/track-openai-ads-event
 *
 * The real app forwards conversion events to bzr.openai.com (REPORT.md §10).
 * Local mode acknowledges the call and makes no outbound request so a dev
 * machine never emits ad analytics.
 */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = await readJson<Record<string, unknown>>(request);
  return json({
    success: true,
    recorded: false,
    mocked: true,
    event: str(body.event ?? body.event_name) || null,
    note: "Analytics and ad pixels are disabled in local mode.",
  });
}
