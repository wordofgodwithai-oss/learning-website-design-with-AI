import Link from "next/link";

import { DEMO_API_KEY } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const V1_ENDPOINTS = [
  ["POST", "/api/v1/videos/generate", "Multipart generation. Returns job_id + video_id."],
  ["POST", "/api/v1/videos/upload-file", "Upload a reference file (15 MB cap)."],
  ["GET", "/api/v1/videos", "List videos (page, page_size, search, type)."],
  ["GET", "/api/v1/videos/{video_id}", "Fetch one video."],
  ["PATCH", "/api/v1/videos/{video_id}", "Update title / visibility."],
  ["DELETE", "/api/v1/videos/{video_id}", "Delete a video."],
  ["GET", "/api/v1/videos/status/{job_id}", "Poll a generation job."],
  ["GET", "/api/v1/custom-styles", "List custom canvas styles."],
  ["POST", "/api/v1/custom-styles", "Create a custom canvas style."],
];

const V2_ENDPOINTS = [
  ["POST", "/api/v2/videos/generate", "JSON generation with the v2 field vocabulary."],
  ["PATCH", "/api/v2/videos/{video_id}", "Title and visibility only."],
  ["POST", "/api/v2/custom-styles", "Create a custom canvas style (description field)."],
];

export default async function ApiDocsPage() {
  const user = await getSessionUser();

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
            <Link href="/pricing">Pricing</Link>
            <Link href="/mcp">MCP</Link>
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
              <h1 style={{ fontSize: 32 }}>Public API</h1>
              <p>
                REST v1 (multipart) and v2 (JSON), both authenticated with{" "}
                <span className="mono">x-api-key</span>. These are the endpoints documented on
                the production <span className="mono">/api-docs</span> page (REPORT.md §7).
              </p>
            </div>
            <span className="badge badge-accent">Base URL http://localhost:3000</span>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-title">
              <h3>Authentication</h3>
              <span className="badge">{user ? "Signed in" : "Demo key"}</span>
            </div>
            <p style={{ fontSize: 13.5 }}>
              Create a key with <span className="mono">POST /api/create-api-key</span> while
              signed in, or use the seeded development key below. Keys are stored as SHA-256
              hashes and can be revoked from the dashboard API.
            </p>
            <div className="code">{`x-api-key: ${user ? DEMO_API_KEY : "glp_live_…"}`}</div>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-title">
              <h3>Quick start · v1</h3>
              <span className="badge badge-accent">multipart</span>
            </div>
            <div className="code">{`curl -X POST http://localhost:3000/api/v1/videos/generate \\
  -H "x-api-key: $GOLPO_API_KEY" \\
  -F "prompt=Explain how DNS resolves a domain name" \\
  -F "durationSeconds=60" \\
  -F "language=en" \\
  -F "image_style=whiteboard" \\
  -F "variant_languages=[\\"es\\",\\"fr\\"]"

# → 202
# { "job_id": "job_…", "video_id": "vid_…", "status": "queued",
#   "status_url": "/api/v1/videos/status/job_…" }`}</div>
            <div className="code" style={{ marginTop: 12 }}>{`curl http://localhost:3000/api/v1/videos/status/job_… \\
  -H "x-api-key: $GOLPO_API_KEY"

# → { "status": "ready", "progress": 100,
#     "video": { "video_url": "/api/media/vid_…/preview", … } }`}</div>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-title">
              <h3>Quick start · v2</h3>
              <span className="badge badge-accent">JSON</span>
            </div>
            <div className="code">{`curl -X POST http://localhost:3000/api/v2/videos/generate \\
  -H "x-api-key: $GOLPO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{
    "prompt": "Why is the sky blue?",
    "kind": "video",
    "golpo_video_engine": "golpo_sketch",
    "sketch_style_variant": "crayon",
    "narration_language": "en",
    "narration_voice": "ava",
    "scene_pacing": "normal",
    "duration_seconds": 45,
    "visibility": "private"
  }'`}</div>
          </div>

          <div className="grid grid-2" style={{ marginBottom: 18 }}>
            <div className="card">
              <div className="card-title">
                <h3>v1 endpoints</h3>
                <span className="badge">9</span>
              </div>
              <table className="table">
                <tbody>
                  {V1_ENDPOINTS.map(([method, path, description]) => (
                    <tr key={`${method}-${path}`}>
                      <td style={{ width: 62 }}>
                        <span className="badge">{method}</span>
                      </td>
                      <td>
                        <div className="mono">{path}</div>
                        <div className="hint">{description}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <div className="card-title">
                <h3>v2 endpoints</h3>
                <span className="badge">3</span>
              </div>
              <table className="table">
                <tbody>
                  {V2_ENDPOINTS.map(([method, path, description]) => (
                    <tr key={`${method}-${path}`}>
                      <td style={{ width: 62 }}>
                        <span className="badge">{method}</span>
                      </td>
                      <td>
                        <div className="mono">{path}</div>
                        <div className="hint">{description}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="local-note" style={{ marginTop: 12 }}>
                v2 vocabulary: <span className="mono">golpo_video_engine</span>,{" "}
                <span className="mono">canvas_style_variant</span>,{" "}
                <span className="mono">sketch_style_variant</span>,{" "}
                <span className="mono">narration_voice</span>,{" "}
                <span className="mono">narration_language</span>,{" "}
                <span className="mono">scene_pacing</span>,{" "}
                <span className="mono">pen_animation_style</span>,{" "}
                <span className="mono">watermark</span>,{" "}
                <span className="mono">background_track</span>,{" "}
                <span className="mono">video_orientation</span>,{" "}
                <span className="mono">onscreen_text_language</span>.
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">
              <h3>Errors</h3>
              <span className="badge">BFF + API</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Meaning</th>
                  <th>Client copy</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>400</td>
                  <td>Invalid request</td>
                  <td>Field-specific validation message</td>
                </tr>
                <tr>
                  <td>401 / 403</td>
                  <td>Bad or missing credentials</td>
                  <td>“Authentication failed. Please sign in again.”</td>
                </tr>
                <tr>
                  <td>402</td>
                  <td>Out of credits</td>
                  <td>“You don&apos;t have enough credits…” (unreachable locally)</td>
                </tr>
                <tr>
                  <td>404</td>
                  <td>Unknown video/job/key</td>
                  <td><span className="mono">&#123;"error": "…"&#125;</span></td>
                </tr>
                <tr>
                  <td>409</td>
                  <td>Too many concurrent jobs</td>
                  <td>“Multiple video generations detected…”</td>
                </tr>
                <tr>
                  <td>413</td>
                  <td>Upload too large</td>
                  <td>15 MB per file</td>
                </tr>
                <tr>
                  <td>415</td>
                  <td>Unsupported media</td>
                  <td>e.g. PDF script import</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="hint" style={{ marginTop: 18 }}>
            Rate limiting is not implemented locally. The production limits are not observable
            from the client (REPORT.md §13).
          </p>
        </div>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span>API reference reconstructed from the public docs and the dashboard bundle.</span>
          <span className="mono">/api-docs</span>
        </div>
      </footer>
    </>
  );
}
