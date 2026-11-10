import { groqTranscribe } from "@/lib/ai/groq";
import { getUserFromRequest } from "@/lib/auth";
import { transcriptionMode } from "@/lib/integrations";
import { fail, json, readJson, safeFetch, str } from "@/lib/http";

/**
 * POST /api/extract-script-source
 *
 * Turns a document or recording into script text. Accepts:
 *   - multipart `file` (.txt, .md, .csv, .json, .srt, .html)
 *   - multipart `file` (.pdf, .docx) → text extraction
 *   - multipart `file` audio/video (.mp3, .wav, .m4a, .ogg, .webm, .flac, .mp4)
 *     → Groq Whisper with word-level timestamps when GROQ_API_KEY is set
 *   - JSON `{ text: "…" }`
 *   - JSON `{ url: "https://…" }` (size- and address-guarded)
 *
 * PDF and DOCX extraction runs locally (`unpdf` / `mammoth`); no document ever
 * leaves the machine. OCR for scanned PDFs is not implemented.
 */
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".json", ".srt", ".vtt", ".html", ".htm"];
const DOCUMENT_EXTENSIONS = [".pdf", ".docx"];
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".ogg", ".webm", ".flac", ".mp4"];

const AUDIO_CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

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
    return fail(400, "Attach a text file or an audio recording.");
  }

  const extension = extensionOf(file.name);

  if (AUDIO_EXTENSIONS.includes(extension)) {
    if (file.size > MAX_AUDIO_BYTES) {
      return fail(413, "Audio files must be 25 MB or smaller (the Groq upload limit).");
    }
    if (transcriptionMode !== "groq") {
      return fail(
        503,
        "Audio transcription needs GROQ_API_KEY. Add it to .env.local and restart the server.",
      );
    }

    try {
      const transcript = await groqTranscribe(await file.arrayBuffer(), {
        filename: file.name,
        contentType: (AUDIO_CONTENT_TYPES[extension] ?? file.type) || "application/octet-stream",
        // Omit `language` so Whisper auto-detects instead of forcing English.
        language: "auto",
      });
      if (!transcript.text) return fail(422, "No speech was detected in that recording.");
      return json({
        success: true,
        text: transcript.text,
        source_type: "audio",
        filename: file.name,
        language: transcript.language,
        duration: transcript.duration,
        // Word-level timestamps drive the highlight animation in the player.
        words: transcript.words,
        segments: transcript.segments,
        word_count: wordCount(transcript.text),
      });
    } catch (error) {
      return fail(
        502,
        `Transcription failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (DOCUMENT_EXTENSIONS.includes(extension)) {
    if (file.size > MAX_DOCUMENT_BYTES) {
      return fail(413, "Documents must be 10 MB or smaller.");
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text = "";
      if (extension === ".docx") {
        const mammoth = await import("mammoth");
        const extracted = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
        text = extracted.value.trim();
      } else {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(bytes);
        const extracted = await extractText(pdf, { mergePages: true });
        text = (Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text).trim();
      }
      if (!text) {
        return fail(
          422,
          extension === ".pdf"
            ? "No selectable text found. Scanned PDFs need OCR, which is not supported yet."
            : "The document contained no readable text.",
        );
      }
      return json({
        success: true,
        text,
        source_type: extension === ".pdf" ? "pdf" : "docx",
        filename: file.name,
        word_count: wordCount(text),
      });
    } catch (error) {
      return fail(
        422,
        `Could not read that ${extension === ".pdf" ? "PDF" : "DOCX"}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (file.size > MAX_BYTES) return fail(413, "Files must be 2 MB or smaller.");
  if (!TEXT_EXTENSIONS.includes(extension)) {
    return fail(
      415,
      "Unsupported file. Use a text file (.txt, .md, .srt, .vtt, .csv, .json, .html), a document (.pdf, .docx) or audio (.mp3, .wav, .m4a, .ogg, .webm, .flac, .mp4).",
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
