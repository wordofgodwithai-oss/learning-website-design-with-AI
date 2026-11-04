import { getUserFromRequest } from "@/lib/auth";
import { fail, json, readJson, str } from "@/lib/http";

/** POST /api/tell-your-manager — stores feedback locally, sends nothing. */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = await readJson<Record<string, unknown>>(request);
  const message = str(body.message ?? body.feedback).trim();
  if (!message) return fail(400, "message is required.");
  return json({
    success: true,
    message: "Thanks — your note was stored locally. No email was sent.",
    mocked_email: true,
    length: message.length,
  });
}
