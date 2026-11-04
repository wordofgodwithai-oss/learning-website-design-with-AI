import { getUserFromRequest } from "@/lib/auth";
import { fail } from "@/lib/http";
import { safeFetch } from "@/lib/http";
import { saveUploadedBytes } from "@/lib/storage";

/**
 * GET /api/upload-proxy?url=…
 *
 * Proxies a remote image into local storage so the browser is not blocked by
 * CORS when the client needs a same-origin URL. Private/loopback hosts are
 * blocked by safeFetch (SSRF guard).
 */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");

  const target = new URL(request.url).searchParams.get("url");
  if (!target) return fail(400, "url is required.");

  try {
    const fetched = await safeFetch(target, { maxBytes: 10 * 1024 * 1024, accept: "image/*" });
    if (!fetched.contentType.startsWith("image/")) {
      return fail(415, "Only images can be proxied.");
    }
    const upload = await saveUploadedBytes({
      userId: user.id,
      filename: target.split("/").pop()?.split("?")[0] || "proxied-image",
      contentType: fetched.contentType,
      bytes: fetched.bytes,
    });
    return Response.json({ success: true, url: upload.url, upload });
  } catch (error) {
    return fail(400, `Could not proxy that URL: ${(error as Error).message}`);
  }
}
