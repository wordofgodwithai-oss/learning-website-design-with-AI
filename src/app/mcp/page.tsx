import Link from "next/link";

import { DEMO_API_KEY } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { MCP_TOOLS } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

export default async function McpPage() {
  const user = await getSessionUser();
  const key = user ? DEMO_API_KEY : "glp_live_…";

  return (
    <>
      <header className="nav">
        <div className="nav-inner">
          <Link href={user ? "/playground" : "/"} className="brand">
            <span className="brand-mark">G</span>
            <span>
              Golpo <span style={{ color: "var(--muted)", fontWeight: 500 }}>Local</span>
            </span>
          </Link>
          <nav className="nav-links">
            <Link href="/api-docs">API</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/library">Library</Link>
          </nav>
          <div className="nav-spacer" />
          <Link href={user ? "/playground" : "/"} className="btn btn-sm">
            {user ? "Playground" : "Home"}
          </Link>
        </div>
      </header>

      <main className="page">
        <div className="container">
          <div className="page-head">
            <div>
              <h1 style={{ fontSize: 32 }}>MCP server</h1>
              <p>
                The production server exposes six tools at{" "}
                <span className="mono">https://mcp.golpoai.com/mcp</span> (REPORT.md §7). This
                clone serves the same tool set over JSON-RPC 2.0.
              </p>
            </div>
            <span className="badge badge-accent">http://localhost:3000/api/mcp</span>
          </div>

          <div className="grid grid-2" style={{ marginBottom: 18 }}>
            <div className="card">
              <div className="card-title">
                <h3>Client configuration</h3>
                <span className="badge">x-api-key</span>
              </div>
              <div className="code">{`{
  "mcpServers": {
    "golpo-local": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": {
        "x-api-key": "${key}"
      }
    }
  }
}`}</div>
              <p className="hint" style={{ marginTop: 12 }}>
                The seeded development key is defined by{" "}
                <span className="mono">GOLPO_DEV_API_KEY</span> (default{" "}
                <span className="mono">glp_local_dev_key_change_me</span>). Create additional keys
                with <span className="mono">POST /api/create-api-key</span>.
              </p>
            </div>

            <div className="card">
              <div className="card-title">
                <h3>Handshake</h3>
                <span className="badge">JSON-RPC</span>
              </div>
              <div className="code">{`curl -X POST http://localhost:3000/api/mcp \\
  -H "x-api-key: ${key}" \\
  -H "content-type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "generate_video",
      "arguments": {
        "prompt": "Explain photosynthesis in 60 seconds",
        "duration_seconds": 60
      }
    }
  }'`}</div>
              <p className="hint" style={{ marginTop: 12 }}>
                Supported methods: <span className="mono">initialize</span>,{" "}
                <span className="mono">tools/list</span>,{" "}
                <span className="mono">tools/call</span>, <span className="mono">ping</span>.
                Notifications return HTTP 202.
              </p>
            </div>
          </div>

          <div className="card">
            <div className="card-title">
              <h3>Tools</h3>
              <span className="badge">{MCP_TOOLS.length}</span>
            </div>
            <div className="grid grid-2">
              {MCP_TOOLS.map((tool) => (
                <div className="stat" key={tool.name}>
                  <div className="mono" style={{ fontSize: 13, color: "var(--accent)" }}>
                    {tool.name}
                  </div>
                  <div className="hint" style={{ marginTop: 6 }}>
                    {tool.description}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span>MCP tools mirror the production surface; generation is simulated.</span>
          <span className="mono">/mcp</span>
        </div>
      </footer>
    </>
  );
}
