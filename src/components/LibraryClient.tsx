"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CANVAS_STYLES, LANGUAGES, SKETCH_STYLES } from "@/lib/generation/config";
import type { Playlist, Video } from "@/lib/types";

const ALL_STYLES = [...CANVAS_STYLES, ...SKETCH_STYLES];

export function LibraryClient({
  initialVideos,
  initialPlaylists,
  accessToken,
}: {
  initialVideos: Video[];
  initialPlaylists: Playlist[];
  accessToken: string;
}) {
  const [videos, setVideos] = useState<Video[]>(initialVideos);
  const [playlists, setPlaylists] = useState<Playlist[]>(initialPlaylists);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"all" | "video" | "podcast">("all");
  const [style, setStyle] = useState("");
  const [language, setLanguage] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [playlistName, setPlaylistName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const headers = useMemo(() => ({ Authorization: `Bearer ${accessToken}` }), [accessToken]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100", type });
      if (search) params.set("search", search);
      if (style) params.set("style", style);
      if (language) params.set("language", language);
      const response = await fetch(`/api/videos?${params.toString()}`, { headers });
      if (response.ok) {
        const data = (await response.json()) as { videos: Video[] };
        setVideos(data.videos ?? []);
      }
    } catch {
      setNotice({ kind: "error", text: "Could not refresh the library." });
    } finally {
      setLoading(false);
    }
  }, [headers, search, style, language, type]);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 250);
    return () => clearTimeout(timer);
  }, [refresh]);

  async function makePublic(video: Video) {
    const response = await fetch(`/api/videos/${video.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ visibility: video.visibility === "public" ? "private" : "public" }),
    });
    if (response.ok) {
      setVideos((current) =>
        current.map((entry) =>
          entry.id === video.id
            ? { ...entry, visibility: entry.visibility === "public" ? "private" : "public" }
            : entry,
        ),
      );
      setNotice({ kind: "ok", text: `Visibility updated for “${video.title}”.` });
    } else {
      setNotice({ kind: "error", text: "Could not update visibility." });
    }
  }

  async function remove(video: Video) {
    if (!window.confirm(`Delete “${video.title}”?`)) return;
    const response = await fetch(`/api/videos/${video.id}`, { method: "DELETE", headers });
    if (response.ok) {
      setVideos((current) => current.filter((entry) => entry.id !== video.id));
      setSelected((current) => current.filter((id) => id !== video.id));
      setNotice({ kind: "ok", text: "Video deleted." });
    } else {
      setNotice({ kind: "error", text: "Could not delete that video." });
    }
  }

  async function createPlaylist() {
    if (!playlistName.trim() || selected.length === 0) {
      setNotice({ kind: "error", text: "Pick a name and at least one video." });
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/playlists", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ name: playlistName, video_ids: selected }),
      });
      const data = (await response.json()) as { playlist?: Playlist; error?: string };
      if (!response.ok || !data.playlist) {
        setNotice({ kind: "error", text: data.error ?? "Could not create the playlist." });
        return;
      }
      setPlaylists((current) => [data.playlist as Playlist, ...current]);
      setPlaylistName("");
      setSelected([]);
      setNotice({ kind: "ok", text: "Playlist created." });
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(video: Video) {
    const url = `${window.location.origin}/v/${video.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ kind: "ok", text: "Share link copied." });
    } catch {
      setNotice({ kind: "ok", text: url });
    }
  }

  function toggleSelected(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  return (
    <>
      <div className="card card-tight" style={{ marginBottom: 18 }}>
        <div className="field-row" style={{ marginBottom: 12 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <span className="label">Search</span>
            <input
              className="input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Title or script…"
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <span className="label">Type</span>
            <select
              className="select"
              value={type}
              onChange={(event) => setType(event.target.value as typeof type)}
            >
              <option value="all">All</option>
              <option value="video">Video</option>
              <option value="podcast">Podcast</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <span className="label">Style</span>
            <select className="select" value={style} onChange={(event) => setStyle(event.target.value)}>
              <option value="">Any style</option>
              {ALL_STYLES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <span className="label">Language</span>
            <select
              className="select"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              <option value="">Any language</option>
              {LANGUAGES.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span className="badge">{videos.length} videos</span>
          {loading ? <span className="hint">Refreshing…</span> : null}
          <div className="nav-spacer" />
          <input
            className="input"
            style={{ maxWidth: 220 }}
            value={playlistName}
            onChange={(event) => setPlaylistName(event.target.value)}
            placeholder="New playlist name"
          />
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void createPlaylist()}
            disabled={busy || selected.length === 0}
          >
            Create playlist ({selected.length})
          </button>
        </div>
      </div>

      {notice ? (
        <div className={`toast ${notice.kind === "ok" ? "ok" : ""}`} style={{ marginBottom: 18 }}>
          {notice.text}
        </div>
      ) : null}

      {videos.length === 0 ? (
        <div className="empty">
          <p style={{ marginBottom: 12 }}>No videos match these filters.</p>
          <Link href="/playground" className="btn btn-primary">
            Create your first video
          </Link>
        </div>
      ) : (
        <div className="grid grid-3">
          {videos.map((video) => (
            <article className="media-card" key={video.id}>
              <Link href={`/v/${video.id}`} className="video-frame" style={{ borderRadius: 0, border: "none" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/media/${video.id}/poster`} alt="" />
              </Link>
              <div className="media-card-body">
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={selected.includes(video.id)}
                    onChange={() => toggleSelected(video.id)}
                    aria-label={`Select ${video.title}`}
                  />
                  <span className={`badge ${video.visibility === "public" ? "badge-ok" : ""}`}>
                    {video.visibility}
                  </span>
                  <span className="badge">{video.kind}</span>
                </div>
                <div className="media-card-title">{video.title}</div>
                <div className="media-meta">
                  <span>{video.duration_seconds}s</span>
                  <span>{video.style.replace(/_/g, " ")}</span>
                  <span>{video.display_language}</span>
                </div>
                <div className="media-actions">
                  <Link href={`/v/${video.id}`} className="btn btn-sm">
                    Open
                  </Link>
                  <button type="button" className="btn btn-sm" onClick={() => void makePublic(video)}>
                    {video.visibility === "public" ? "Make private" : "Make public"}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => void copyLink(video)}>
                    Copy link
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => void remove(video)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: 22 }}>
        <div className="card-title">
          <h3>Playlists</h3>
          <span className="badge">{playlists.length}</span>
        </div>
        {playlists.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5 }}>
            Select videos above and create a playlist — the real app uses the same multi-select
            flow (REPORT.md section 11).
          </p>
        ) : (
          <div className="list">
            {playlists.map((playlist) => (
              <div className="list-row" key={playlist.id}>
                <div>
                  <div style={{ fontWeight: 600 }}>{playlist.name}</div>
                  <div className="hint">{playlist.video_ids.length} videos</div>
                </div>
                <span className="badge">{new Date(playlist.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
