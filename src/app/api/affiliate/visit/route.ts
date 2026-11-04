import { getUserFromRequest } from "@/lib/auth";
import { fail, json, readJson, str } from "@/lib/http";

/** POST /api/affiliate/visit — records an affiliate visit locally. */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = await readJson<Record<string, unknown>>(request);
  return json({
    success: true,
    recorded: true,
    code: str(body.code ?? body.ref) || null,
    mocked: true,
  });
}
