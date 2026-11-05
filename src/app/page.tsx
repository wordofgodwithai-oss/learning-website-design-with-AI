import Link from "next/link";

import { SignInPanel } from "@/components/SignInPanel";
import { getSessionUser } from "@/lib/auth";
import { getBalance } from "@/lib/billing";
import { planName } from "@/lib/billing/shared";
import { publicConfig } from "@/lib/integrations";

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; auth_error?: string }>;
}) {
  const { redirect, auth_error: authError } = await searchParams;
  const user = await getSessionUser();
  const balance = user ? await getBalance(user.id) : null;
  const config = publicConfig();
  const redirectTo = redirect?.startsWith("/") ? redirect : "/playground";

  return (
    <>
      <header className="nav">
        <div className="nav-inner">
          <Link href="/" className="brand">
            <span className="brand-mark">G</span>
            <span>
              Golpo <span style={{ color: "var(--muted)", fontWeight: 500 }}>Local</span>
            </span>
          </Link>
          <nav className="nav-links">
            <Link href="/pricing">Pricing</Link>
            <Link href="/api-docs">API</Link>
            <Link href="/mcp">MCP</Link>
            <Link href="/library">Library</Link>
          </nav>
          <div className="nav-spacer" />
          {user ? (
            <>
              <span className="credits-pill">
                <span className="status-dot" />
                {balance?.credits.toLocaleString()} credits
              </span>
              <Link href="/playground" className="btn btn-primary btn-sm">
                Open playground
              </Link>
            </>
          ) : (
            <a href="#signin" className="btn btn-sm">
              Sign in
            </a>
          )}
        </div>
      </header>

      <main>
        <section className="container hero">
          <div>
            <span className="eyebrow">Local reconstruction · from REPORT.md</span>
            <h1>
              Turn a sentence into an <span>explainer video</span>
            </h1>
            <p className="hero-lead">
              The Golpo dashboard rebuilt to run on your machine: prompt-to-video playground,
              library, BFF, public API v1/v2 and an MCP endpoint. Real MP4 rendering, optional
              Groq scripts, Supabase auth and Stripe billing.
            </p>
            <ul className="hero-points">
              <li>Canvas and Sketch engines with the full style catalogue</li>
              <li>Real job polling, language variants and a persistent library</li>
              <li>API keys, v1/v2 REST endpoints and six MCP tools</li>
              <li>Mock billing out of the box; add Stripe keys to go live</li>
            </ul>
            <div style={{ display: "flex", gap: 12, marginTop: 28, flexWrap: "wrap" }}>
              <Link href={user ? "/playground" : "#signin"} className="btn btn-primary">
                {user ? "Create a video" : "Start creating"}
              </Link>
              <Link href="/api-docs" className="btn">
                Read the API docs
              </Link>
            </div>
          </div>

          <div id="signin">
            {user ? (
              <div className="card login-card">
                <span className="badge badge-ok">Signed in</span>
                <h2 style={{ marginTop: 14 }}>Welcome back, {user.display_name}</h2>
                <p className="hint">{user.email}</p>
                <div className="stats" style={{ marginTop: 18 }}>
                  <div className="stat">
                    <div className="stat-label">Credits</div>
                    <div className="stat-value">{balance?.credits.toLocaleString()}</div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">Plan</div>
                    <div className="stat-value" style={{ fontSize: 15 }}>
                      {planName(balance?.plan)}
                    </div>
                  </div>
                </div>
                <div style={{ display: "grid", gap: 10, marginTop: 20 }}>
                  <Link href="/playground" className="btn btn-primary btn-block">
                    Open the playground
                  </Link>
                  <Link href="/library" className="btn btn-block">
                    Go to library
                  </Link>
                </div>
                <div className="local-note">
                  {balance?.unlimited
                    ? "Every feature is unlocked and credits never decrease."
                    : `Billing is live through Stripe. ${balance?.credits.toLocaleString()} credits remaining.`}
                </div>
              </div>
            ) : (
              <SignInPanel
                redirectTo={redirectTo}
                authMode={config.authMode}
                supabase={config.supabase}
                initialError={authError ?? null}
              />
            )}
          </div>
        </section>

        <section className="container" style={{ paddingBottom: 24 }}>
          <div className="grid grid-3">
            <div className="card card-tight">
              <h3 style={{ fontSize: 16 }}>Prompt → storyboard → render</h3>
              <p style={{ fontSize: 13.5, marginBottom: 0 }}>
                The pipeline from the report: script, scenes, narration, visuals, encode. Jobs
                persist across reloads and polling resumes automatically.
              </p>
            </div>
            <div className="card card-tight">
              <h3 style={{ fontSize: 16 }}>The BFF contract, implemented</h3>
              <p style={{ fontSize: 13.5, marginBottom: 0 }}>
                Startup calls for characters, styles, voice clones, music, organizations, avatars
                and changelogs all return the observed shapes.
              </p>
            </div>
            <div className="card card-tight">
              <h3 style={{ fontSize: 16 }}>API and MCP included</h3>
              <p style={{ fontSize: 13.5, marginBottom: 0 }}>
                Authenticate with <span className="mono">x-api-key</span>, generate through v1/v2,
                or call the six MCP tools from any MCP client.
              </p>
            </div>
          </div>
        </section>

        <section className="container" style={{ padding: "16px 0 64px" }}>
          <div className="card">
            <div className="card-title">
              <h3>Generation pipeline</h3>
              <span className="badge">FFmpeg renderer</span>
            </div>
            <div className="stats">
              <div className="stat">
                <div className="stat-label">1 · Script</div>
                <div className="stat-value" style={{ fontSize: 14 }}>
                  Prompt or pasted script becomes narration
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">2 · Scenes</div>
                <div className="stat-value" style={{ fontSize: 14 }}>
                  Storyboard split by duration
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">3 · Narration</div>
                <div className="stat-value" style={{ fontSize: 14 }}>
                  Voice, language and variants
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">4 · Render</div>
                <div className="stat-value" style={{ fontSize: 14 }}>
                  Poster and animated preview
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span>
            Built from <span className="mono">REPORT.md</span> for local learning. Not affiliated
            with Golpo AI.
          </span>
          <span className="mono">localhost:3000</span>
        </div>
      </footer>
    </>
  );
}
