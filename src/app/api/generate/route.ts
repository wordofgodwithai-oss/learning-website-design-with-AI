import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { authenticateApiKey } from "@/lib/api-auth";
import { normalizeGenerationInput } from "@/lib/generation/request";
import { startGeneration } from "@/lib/generation/pipeline";
import { ensureJobWorker } from "@/lib/generation/worker";
import { generationErrorResponse, readGenerationBody } from "@/lib/generation/http";

/**
 * POST /api/generate
 *
 * Multipart form-data, `Authorization: Bearer <access token>` — the same
 * contract the playground uses (REPORT.md section 6). Also accepts an
 * `x-api-key` so the route can be exercised without a browser session.
 *
 * The real client retries up to 3 times and aborts after 60 s; both are client
 * concerns and are implemented in src/components/Playground.tsx.
 */
export async function POST(request: Request) {
  const user = (await getUserFromRequest(request)) ?? (await authenticateApiKey(request))?.user;
  if (!user) {
    return fail(401, "Authentication failed. Please sign in again.", { code: "unauthorized" });
  }

  try {
    await ensureJobWorker();
    const { fields, uploadUrls } = await readGenerationBody(request, user.id);
    const input = normalizeGenerationInput(fields, { uploadUrls });
    const snapshot = await startGeneration(user, input);
    return json(snapshot, 200);
  } catch (error) {
    return generationErrorResponse(error);
  }
}
