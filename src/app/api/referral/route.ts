import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";

/** POST /api/referral — observed response shape `{status, message}`. */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  return json({
    status: "ok",
    message:
      "Referrals are disabled in local mode. The real endpoint returns the user's referral code and reward progress.",
    referral_code: null,
    referrals: 0,
  });
}
