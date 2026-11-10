import { requireApiKey } from "@/lib/api-auth";
import { fail, json } from "@/lib/http";
import { syncJob } from "@/lib/generation/pipeline";
import { ensureJobWorker } from "@/lib/generation/worker";

/**
 * GET /api/v1/videos/status/{job_id}
 * Poll target for v1. Mirrors the dashboard's /api/generate/poll payload.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ job_id: string }> },
) {
  const identity = await requireApiKey(request);
  if (identity instanceof Response) return identity;

  const { job_id } = await params;
  await ensureJobWorker();
  const snapshot = await syncJob(job_id, identity.user.id);
  if (!snapshot) return fail(404, "Job not found.", { code: "job_not_found" });
  return json(snapshot);
}
