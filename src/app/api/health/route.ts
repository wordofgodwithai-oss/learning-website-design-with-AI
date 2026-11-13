import {
  APP_URL,
  billingMode,
  integrationSummary,
  GROQ_BASE_URL,
  GROQ_TRANSCRIBE_MODEL,
  renderMode,
  scriptMode,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  transcriptionMode,
  ttsMode,
  unlimitedDevOverride,
} from "@/lib/integrations";
import { json } from "@/lib/http";
import { DB_HOST, DB_LABEL, DB_NAME, DB_PORT } from "@/lib/mysql";
import { getSystemStatus } from "@/lib/repo";
import { ensureJobWorker } from "@/lib/generation/worker";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Non-secret runtime status: which implementation each capability resolved to.
 * Useful after editing `.env.local` to confirm the server picked the change up
 * without digging through logs. Safe to call unauthenticated.
 */
export async function GET() {
  // Probing health is the natural boot hook: it starts the background worker
  // and clears jobs abandoned by a previous process.
  await ensureJobWorker();
  const systemStatus = await getSystemStatus().catch(() => null);

  return json(
    {
      ok: true,
      service: "golpo-local",
      integrations: integrationSummary(),
      config: {
        auth: {
          mode: "mysql",
          database: DB_LABEL,
          host: DB_HOST,
          port: DB_PORT,
          name: DB_NAME,
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
          custom_base_url: GROQ_BASE_URL !== "https://api.groq.com/openai/v1",
        },
        transcription: {
          mode: transcriptionMode,
          model: transcriptionMode === "groq" ? GROQ_TRANSCRIBE_MODEL : null,
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
