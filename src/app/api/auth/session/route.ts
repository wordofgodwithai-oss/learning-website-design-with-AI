import { getSessionToken, getSessionUser, toPublicUser, verifyAccessToken } from "@/lib/auth";
import { getBalance } from "@/lib/billing";
import { featureMatrix } from "@/lib/features";
import { json } from "@/lib/http";
import { getSystemStatus } from "@/lib/repo";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return json({
      user: null,
      authenticated: false,
      features: featureMatrix({ plan: "local-unlimited", unlimited: true }),
    });
  }
  const [balance, systemStatus, token] = await Promise.all([
    getBalance(user.id),
    getSystemStatus(),
    getSessionToken(),
  ]);
  const session = token ? await verifyAccessToken(token) : null;
  const expiresAt = session?.exp ?? Math.floor(Date.now() / 1_000) + 60 * 60 * 24 * 30;
  return json({
    authenticated: true,
    user: toPublicUser(user),
    access_token: token,
    token_type: "bearer",
    expires_at: expiresAt,
    credits: balance.credits,
    plan: balance.plan,
    addons: balance.addons,
    unlimited: balance.unlimited,
    mocked_billing: balance.mocked,
    features: featureMatrix(balance),
    system_status: systemStatus,
  });
}
