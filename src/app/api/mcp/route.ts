import { authenticateApiKey } from "@/lib/api-auth";
import { json } from "@/lib/http";
import {
  MCP_TOOLS,
  handleMcpMessage,
  type JsonRpcRequest,
} from "@/lib/mcp/server";

/**
 * POST /api/mcp — MCP endpoint (JSON-RPC 2.0 over HTTP).
 *
 * Production equivalent: https://mcp.golpoai.com/mcp with the same six tools
 * (REPORT.md section 7). Authenticate with `x-api-key`.
 */
export async function POST(request: Request) {
  const identity = await authenticateApiKey(request);
  if (!identity) {
    return json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: "Unauthorized: send a valid x-api-key header." },
      },
      401,
    );
  }

  const body = (await request.json().catch(() => null)) as
    | JsonRpcRequest
    | JsonRpcRequest[]
    | null;
  if (!body) {
    return json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      400,
    );
  }

  if (Array.isArray(body)) {
    const responses = await Promise.all(
      body.map((message) => handleMcpMessage(identity.user, message)),
    );
    return json(responses.filter(Boolean));
  }

  const response = await handleMcpMessage(identity.user, body);
  if (response === null) return new Response(null, { status: 202 });
  return json(response);
}

/** GET /api/mcp — discovery/documentation view for humans and probes. */
export async function GET() {
  return json({
    name: "golpo-local-mcp",
    transport: "json-rpc-over-http",
    protocol_version: "2025-06-18",
    endpoint: "/api/mcp",
    auth: "x-api-key",
    tools: MCP_TOOLS.map((tool) => ({ name: tool.name, description: tool.description })),
    example: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "generate_video",
        arguments: { prompt: "Explain photosynthesis in 60 seconds", duration_seconds: 60 },
      },
    },
  });
}
