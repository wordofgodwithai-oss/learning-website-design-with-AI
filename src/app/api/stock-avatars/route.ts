import { getUserFromRequest } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { AVATAR_PRESENTATION_MODES, AVATAR_STYLIZATION } from "@/lib/generation/config";

/**
 * GET /api/stock-avatars
 *
 * Stock presenter catalogue. The real list is server-side and its ids are not
 * observable from the bundle, so these are local stand-ins with the same shape.
 */
const STOCK_AVATARS = [
  { id: "stock_ava", name: "Ava", renderer: "studio", presentation_mode: "half_body", stylized: true, credits_per_minute: 3 },
  { id: "stock_noah", name: "Noah", renderer: "studio", presentation_mode: "half_body", stylized: true, credits_per_minute: 3 },
  { id: "stock_maya", name: "Maya", renderer: "whiteboard", presentation_mode: "full_body", stylized: true, credits_per_minute: 3 },
  { id: "stock_luca", name: "Luca", renderer: "cutout", presentation_mode: "head", stylized: true, credits_per_minute: 3 },
];

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  return json({
    success: true,
    avatars: STOCK_AVATARS,
    stylization_enabled: AVATAR_STYLIZATION,
    presentation_modes: AVATAR_PRESENTATION_MODES,
  });
}
