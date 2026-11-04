import Link from "next/link";
import { notFound } from "next/navigation";

import { getSessionUser } from "@/lib/auth";
import { getVideo, listVideos } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = await getVideo(id);
  if (!video) notFound();

  const viewer = await getSessionUser();
  const isOwner = viewer?.id === video.user_id;
  if (video.visibility !== "public" && !isOwner) notFound();

  const variants = isOwner
    ? (await listVideos(video.user_id, { limit: 100 })).filter(
        (entry) => entry.variant_of === video.id,
      )
    : [];

  return (
    <>
      <header className="nav">
        <div className="nav-inner">
          <Link href={viewer ? "/playground" : "/"} className="brand">
            <span className="brand-mark">G</span>
            <span>
              Golpo <span style={{ color: "var(--muted)", fontWeight: 500 }}>Local</span>
            </span>
          </Link>
          <div className="nav-spacer" />
          <Link href={viewer ? "/library" : "/"} className="btn btn-sm">
            {viewer ? "Library" : "Sign in"}
          </Link>
        </div>
      </header>

      <main className="page">
        <div className="container-narrow">
          <div className="video-frame" style={{ marginBottom: 22 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/media/${video.id}/preview`} alt={`Preview of ${video.title}`} />
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <span className={`badge ${video.status === "ready" ? "badge-ok" : "badge-warn"}`}>
              {video.status}
            </span>
            <span className="badge">{video.kind}</span>
            <span className="badge">{video.engine.replace(/_/g, " ")}</span>
            <span className="badge">{video.visibility}</span>
            {video.watermark ? <span className="badge badge-warn">watermark</span> : null}
          </div>

          <h1 style={{ fontSize: 30 }}>{video.title}</h1>
          <div className="media-meta" style={{ marginBottom: 20 }}>
            <span>{video.duration_seconds}s</span>
            <span>{video.style.replace(/_/g, " ")}</span>
            <span>{video.display_language}</span>
            <span>{new Date(video.created_at).toLocaleString()}</span>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-title">
              <h3>Script</h3>
              <a className="btn btn-sm" href={`/api/media/${video.id}/poster`} download>
                Download poster
              </a>
            </div>
            <div className="script-box">{video.script ?? "No script recorded."}</div>
          </div>

          {variants.length > 0 ? (
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="card-title">
                <h3>Language variants</h3>
                <span className="badge">{variants.length}</span>
              </div>
              <div className="list">
                {variants.map((variant) => (
                  <div className="list-row" key={variant.id}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{variant.display_language}</div>
                      <div className="hint">{variant.duration_seconds}s</div>
                    </div>
                    <Link href={`/v/${variant.id}`} className="btn btn-sm">
                      Open
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <p className="hint">
            The playback above is a simulated animated storyboard rendered from the stored script.
            Replace <span className="mono">src/lib/media/svg.ts</span> with a real renderer to serve
            MP4 files.
          </p>
        </div>
      </main>
    </>
  );
}
