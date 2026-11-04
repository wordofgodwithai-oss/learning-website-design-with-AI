import "server-only";

import { getBalance } from "@/lib/billing";
import { normalizeGenerationInput } from "@/lib/generation/request";
import { startGeneration, syncJob } from "@/lib/generation/pipeline";
import { getVideo, listVideos, listApiKeys } from "@/lib/repo";
import { saveUploadedBytes } from "@/lib/storage";
import { str, num, bool } from "@/lib/http";
import type { User } from "@/lib/types";

/**
 * MCP surface (REPORT.md section 7): six tools —
 * generate_video, upload_file, list_videos, get_video, check_status, status.
 *
 * Transport here is JSON-RPC 2.0 over HTTP POST (streamable-HTTP style, no SSE
 * stream). The production server lives at https://mcp.golpoai.com/mcp and is
 * authenticated with a Golpo API key.
 */

export const MCP_SERVER_INFO = { name: "golpo-local-mcp", version: "0.1.0" };
const PROTOCOL_VERSION = "2025-06-18";

export const MCP_TOOLS = [
  {
    name: "generate_video",
    description:
      "Generate an explainer video or podcast from a prompt. Returns a job id to poll with check_status.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What the video should explain." },
        kind: { type: "string", enum: ["video", "podcast"], default: "video" },
        engine: { type: "string", enum: ["golpo_canvas", "golpo_sketch"], default: "golpo_canvas" },
        style: {
          type: "string",
          description: "Canvas style (whiteboard, neon, …) or sketch style (classic, crayon, …).",
        },
        duration_seconds: { type: "number", minimum: 15, maximum: 900, default: 60 },
        language: { type: "string", default: "en" },
        watermark: { type: "boolean", default: false },
        visibility: { type: "string", enum: ["private", "public", "unlisted"], default: "private" },
        variant_languages: {
          type: "array",
          items: { type: "string" },
          description: "Up to 10 additional language variants.",
        },
        script_only: {
          type: "boolean",
          default: false,
          description: "Return the script without rendering a video.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "upload_file",
    description:
      "Upload a reference file (image, audio, video) and get a local URL usable in generate_video.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string" },
        content_type: { type: "string" },
        content_base64: { type: "string", description: "Base64-encoded file contents (max 15 MB)." },
      },
      required: ["filename", "content_base64"],
    },
  },
  {
    name: "list_videos",
    description: "List the authenticated user's videos, newest first.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", default: 20, maximum: 100 } },
    },
  },
  {
    name: "get_video",
    description: "Fetch a single video by id.",
    inputSchema: {
      type: "object",
      properties: { video_id: { type: "string" } },
      required: ["video_id"],
    },
  },
  {
    name: "check_status",
    description: "Poll a generation job by id.",
    inputSchema: {
      type: "object",
      properties: { job_id: { type: "string" } },
      required: ["job_id"],
    },
  },
  {
    name: "status",
    description: "Server status: version, credits, plan and library counts.",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

type ToolArgs = Record<string, unknown>;

function textResult(payload: unknown, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError,
  };
}

async function callTool(user: User, name: string, args: ToolArgs) {
  switch (name) {
    case "generate_video": {
      const prompt = str(args.prompt).trim();
      if (!prompt) return textResult({ error: "prompt is required" }, true);
      const fields: Record<string, unknown> = {
        prompt,
        kind: str(args.kind, "video"),
        golpo_video_engine: str(args.engine, "golpo_canvas"),
        style: str(args.style) || undefined,
        image_style: str(args.style) || undefined,
        durationSeconds: num(args.duration_seconds, 60),
        language: str(args.language, "en"),
        include_watermark: bool(args.watermark),
        force_watermark: bool(args.watermark),
        is_public: str(args.visibility) === "public",
        variant_languages: Array.isArray(args.variant_languages)
          ? args.variant_languages.map(String)
          : [],
        just_return_script: bool(args.script_only),
      };
      try {
        const snapshot = await startGeneration(user, normalizeGenerationInput(fields));
        return textResult({
          job_id: snapshot.job_id,
          video_id: snapshot.video_id,
          status: snapshot.status,
          script: snapshot.script,
          poll_with: "check_status",
        });
      } catch (error) {
        return textResult({ error: (error as Error).message }, true);
      }
    }

    case "upload_file": {
      const filename = str(args.filename, "upload.bin");
      const base64 = str(args.content_base64);
      if (!base64) return textResult({ error: "content_base64 is required" }, true);
      let bytes: Buffer;
      try {
        bytes = Buffer.from(base64, "base64");
      } catch {
        return textResult({ error: "content_base64 is not valid base64" }, true);
      }
      if (bytes.byteLength === 0) return textResult({ error: "File is empty" }, true);
      if (bytes.byteLength > 15 * 1024 * 1024) {
        return textResult({ error: "File exceeds the 15 MB limit" }, true);
      }
      const upload = await saveUploadedBytes({
        userId: user.id,
        filename,
        contentType: str(args.content_type, "application/octet-stream"),
        bytes,
      });
      return textResult({ file_id: upload.id, url: upload.url, size: upload.size });
    }

    case "list_videos": {
      const limit = Math.min(100, Math.max(1, Math.trunc(num(args.limit, 20))));
      const videos = await listVideos(user.id, { limit });
      return textResult({
        count: videos.length,
        videos: videos.map((video) => ({
          id: video.id,
          title: video.title,
          status: video.status,
          kind: video.kind,
          style: video.style,
          language: video.language,
          duration_seconds: video.duration_seconds,
          created_at: video.created_at,
        })),
      });
    }

    case "get_video": {
      const video = await getVideo(str(args.video_id), user.id);
      if (!video) return textResult({ error: "Video not found" }, true);
      return textResult(video);
    }

    case "check_status": {
      const snapshot = await syncJob(str(args.job_id), user.id);
      if (!snapshot) return textResult({ error: "Job not found" }, true);
      return textResult(snapshot);
    }

    case "status": {
      const [balance, videos, keys] = await Promise.all([
        getBalance(user.id),
        listVideos(user.id, { limit: 100 }),
        listApiKeys(user.id),
      ]);
      return textResult({
        server: MCP_SERVER_INFO,
        protocol_version: PROTOCOL_VERSION,
        user: { id: user.id, email: user.email },
        credits: balance.credits,
        plan: balance.plan,
        mocked_billing: true,
        videos: videos.length,
        active_api_keys: keys.filter((key) => !key.revoked_at).length,
      });
    }

    default:
      return textResult({ error: `Unknown tool: ${name}` }, true);
  }
}

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Handles one JSON-RPC message. Returns null for notifications. */
export async function handleMcpMessage(user: User, message: JsonRpcRequest) {
  const id = message.id ?? null;
  const method = message.method ?? "";

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions:
          "Local Golpo clone. Billing is mocked and credits are unlimited. Generation is simulated but jobs, videos and polling behave like the real API.",
      },
    };
  }

  if (method === "notifications/initialized" || method.startsWith("notifications/")) {
    return null;
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
  }

  if (method === "tools/call") {
    const params = message.params ?? {};
    const name = str(params.name);
    const args = (params.arguments ?? {}) as ToolArgs;
    const tool = MCP_TOOLS.find((entry) => entry.name === name);
    if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
    try {
      return { jsonrpc: "2.0", id, result: await callTool(user, name, args) };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        result: textResult({ error: (error as Error).message }, true),
      };
    }
  }

  if (method === "resources/list") {
    return { jsonrpc: "2.0", id, result: { resources: [] } };
  }

  if (method === "prompts/list") {
    return { jsonrpc: "2.0", id, result: { prompts: [] } };
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}
