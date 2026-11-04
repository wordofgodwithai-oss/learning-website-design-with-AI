import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { SCENE_PREPARATION_DEFAULTS } from "@/lib/generation/config";

/** GET /api/custom-scene-selection/defaults */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  return json({
    success: true,
    defaults: SCENE_PREPARATION_DEFAULTS,
    // Feature is unlocked locally (see src/lib/features.ts).
    available: true,
  });
}
