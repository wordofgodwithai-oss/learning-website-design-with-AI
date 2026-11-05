import {
  APP_URL,
  authMode,
  billingMode,
  integrationSummary,
  OPENAI_BASE_URL,
  renderMode,
  scriptMode,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  ttsMode,
  unlimitedDevOverride,
} from "@/lib/integrations";
import { json } from "@/lib/http";
import { getSystemStatus } from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Non-secret runtime status: which implementation each capability resolved to.
 * Useful after editing `.env.local` to confirm the server picked the change up
 * without digging through logs. Safe to call unauthenticated.
 */
export async function GET() {
  const systemStatus = await getSystemStatus().catch(() => null);

  return json(
    {
      ok: true,
      service: "golpo-local",
      integrations: integrationSummary(),
      config: {
        auth: {
          mode: authMode,
          oauth_configured: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY),
        },
        billing: {
          mode: billingMode,
          stripe_configured: Boolean(STRIPE_SECRET_KEY),
          webhook_configured: Boolean(STRIPE_WEBHOOK_SECRET),
          test_mode: STRIPE_SECRET_KEY.startsWith("sk_test_"),
          unlimited_override: unlimitedDevOverride,
        },
        scripts: {
          mode: scriptMode,
          custom_base_url: OPENAI_BASE_URL !== "https://api.openai.com/v1",
        },
        narration: { mode: ttsMode },
        render: { mode: renderMode },
        app_url: APP_URL,
      },
      system_status: systemStatus,
    },
    200,
    { "cache-control": "no-store" },
  );
}
