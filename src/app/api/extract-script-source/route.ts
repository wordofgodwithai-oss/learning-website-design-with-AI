import { getUserFromRequest } from "@/lib/auth";
import { fail, json, readJson, safeFetch, str } from "@/lib/http";

/**
 * POST /api/extract-script-source
 *
 * Turns a document into script text. Accepts:
 *   - multipart `file` (.txt, .md, .csv, .json, .srt, .html)
 *   - JSON `{ text: "…" }`
 *   - JSON `{ url: "https://…" }` (size- and address-guarded)
 *
 * PDF/DOCX parsing is intentionally NOT implemented: the real extractor runs
 * server-side and its libraries are not observable.
 *
 * TODO(REAL-EXTRACT): add pdf-parse / mammoth and an OCR path.
 */
const MAX_BYTES = 2 * 1024 * 1024;
const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".json", ".srt", ".vtt", ".html", ".htm"];

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function srtToText(srt: string): string {
  return srt
    .replace(/\r/g, "")
    .replace(/^WEBVTT.*$/gim, "")
    .replace(/^\d+$/gm, "")
    .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = await readJson<Record<string, unknown>>(request);
    const text = str(body.text).trim();
    if (text) {
      return json({ success: true, text, source_type: "text", word_count: wordCount(text) });
    }
    const url = str(body.url).trim();
    if (!url) return fail(400, "Send text, url or a file.");

    try {
      const fetched = await safeFetch(url, { maxBytes: MAX_BYTES, accept: "text/html,text/plain" });
      const raw = fetched.bytes.toString("utf8");
      const isHtml = fetched.contentType.includes("html");
      const extracted = isHtml ? htmlToText(raw) : raw.trim();
      if (!extracted) return fail(422, "No readable text found at that URL.");
      return json({
        success: true,
        text: extracted,
        source_type: "url",
        source_url: fetched.finalUrl,
        word_count: wordCount(extracted),
      });
    } catch (error) {
      return fail(400, `Could not import that URL: ${(error as Error).message}`);
    }
  }

  const form = await request.formData().catch(() => null);
  if (!form) return fail(400, "Expected multipart/form-data.");
  const file = form.get("file") ?? form.get("source");
  if (!(file instanceof File) || file.size === 0) {
    return fail(400, "Attach a .txt, .md, .srt, .csv, .json or .html file.");
  }
  if (file.size > MAX_BYTES) return fail(413, "Files must be 2 MB or smaller.");

  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!TEXT_EXTENSIONS.includes(extension)) {
    return fail(
      415,
      "Only plain-text formats are supported locally (.txt, .md, .srt, .vtt, .csv, .json, .html). PDF and DOCX extraction is not implemented.",
    );
  }

  const raw = Buffer.from(await file.arrayBuffer()).toString("utf8");
  const text = extension === ".html" || extension === ".htm"
    ? htmlToText(raw)
    : extension === ".srt" || extension === ".vtt"
      ? srtToText(raw)
      : raw.trim();

  if (!text) return fail(422, "The file contained no readable text.");
  return json({
    success: true,
    text,
    source_type: "file",
    filename: file.name,
    word_count: wordCount(text),
  });
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
