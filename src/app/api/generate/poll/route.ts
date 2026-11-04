import { getUserFromRequest } from "@/lib/auth";
import { authenticateApiKey } from "@/lib/api-auth";
import { fail, json, readJson, str } from "@/lib/http";
import { syncJob } from "@/lib/generation/pipeline";

/**
 * POST /api/generate/poll
 *
 * The report shows the client sending `{job_id, video_id, …}`, a 30 s timeout
 * and 2 retries, polling `kind === "unknown"` for up to 10 minutes
 * (REPORT.md section 6, step 4). The server only needs `job_id`.
 */
export async function POST(request: Request) {
  const user = (await getUserFromRequest(request)) ?? (await authenticateApiKey(request))?.user;
  if (!user) {
    return fail(401, "Authentication failed. Please sign in again.", { code: "unauthorized" });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let jobId = "";
  if (contentType.includes("application/json")) {
    const body = await readJson<Record<string, unknown>>(request);
    jobId = str(body.job_id ?? body.jobId);
  } else {
    const form = await request.formData().catch(() => null);
    jobId = str(form?.get("job_id") ?? form?.get("jobId"));
  }

  if (!jobId) return fail(400, "job_id is required.", { code: "invalid_request" });

  const snapshot = await syncJob(jobId, user.id);
  if (!snapshot) return fail(404, "Job not found.", { code: "job_not_found" });
  return json(snapshot);
}

export async function GET(request: Request) {
  const user = (await getUserFromRequest(request)) ?? (await authenticateApiKey(request))?.user;
  if (!user) return fail(401, "Authentication failed. Please sign in again.");
  const jobId = new URL(request.url).searchParams.get("job_id") ?? "";
  if (!jobId) return fail(400, "job_id is required.");
  const snapshot = await syncJob(jobId, user.id);
  if (!snapshot) return fail(404, "Job not found.");
  return json(snapshot);
}
