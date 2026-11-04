import { json } from "@/lib/http";
import { getSystemStatus } from "@/lib/repo";

/** GET /api/broadcast — the status banner read from the `system_status` row. */
export async function GET() {
  const status = await getSystemStatus();
  return json({ success: true, broadcast: status });
}
