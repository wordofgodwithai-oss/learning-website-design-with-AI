"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  CANVAS_STYLES,
  DURATION_LIMITS,
  LANGUAGES,
  PACING,
  SKETCH_STYLES,
  VOICES,
  languageName,
} from "@/lib/generation/config";
import type { Character, CustomMusic, Video } from "@/lib/types";

interface StockAvatar {
  id: string;
  name: string;
  renderer: string;
}

interface JobState {
  jobId: string;
  videoId: string | null;
  status: string;
  stage: string;
  progress: number;
  script: string | null;
  video: Video | null;
  variants: string[];
  error: string | null;
}

const LAST_GENERATION_KEY = "golpo:lastGeneration";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts: number,
  timeoutMs: number,
): Promise<Response> {
  let lastError: unknown = new Error("Request failed");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (response.status >= 500 && attempt < attempts - 1) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

function describeStage(stage: string): string {
  return stage.replace(/_/g, " ");
}

export function Playground({
  accessToken,
  credits,
  email,
}: {
  accessToken: string;
  credits: number;
  email: string;
}) {
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<"video" | "podcast">("video");
  const [engine, setEngine] = useState<"golpo_canvas" | "golpo_sketch">("golpo_canvas");
  const [canvasStyle, setCanvasStyle] = useState<string>("whiteboard");
  const [sketchStyle, setSketchStyle] = useState<string>("classic");
  const [duration, setDuration] = useState(60);
  const [language, setLanguage] = useState("en");
  const [voice, setVoice] = useState(VOICES[0].id);
  const [pacing, setPacing] = useState<string>("normal");
  const [orientation, setOrientation] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [color, setColor] = useState(true);
  const [watermark, setWatermark] = useState(false);
  const [scriptOnly, setScriptOnly] = useState(false);
  const [fillIn, setFillIn] = useState(false);
  const [aiPresenter, setAiPresenter] = useState(false);
  const [ownNarration, setOwnNarration] = useState(false);
  const [ownNarrationAvatar, setOwnNarrationAvatar] = useState("stock_ava");
  const [variants, setVariants] = useState<string[]>([]);
  const [musicId, setMusicId] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const [stockAvatars, setStockAvatars] = useState<StockAvatar[]>([]);
  const [music, setMusic] = useState<CustomMusic[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacters, setSelectedCharacters] = useState<string[]>([]);
  const [startup, setStartup] = useState<{ name: string; ok: boolean; detail: string }[]>([]);
  const [recent, setRecent] = useState<Video[]>([]);

  const [job, setJob] = useState<JobState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const pollAbort = useRef(false);

  const headers = useCallback(
    () => ({ Authorization: `Bearer ${accessToken}` }),
    [accessToken],
  );

  const loadRecent = useCallback(async () => {
    try {
      const response = await fetch("/api/videos?limit=6", { headers: headers() });
      if (response.ok) {
        const data = (await response.json()) as { videos: Video[] };
        setRecent(data.videos ?? []);
      }
    } catch {
      // Non-fatal: the library is also reachable from the nav.
    }
  }, [headers]);

  // Startup BFF calls, mirroring the playground load sequence in REPORT.md §5.
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const calls: { name: string; run: () => Promise<Response> }[] = [
        { name: "/api/referral", run: () => fetch("/api/referral", { method: "POST", headers: headers() }) },
        { name: "/api/get-user-characters", run: () => fetch("/api/get-user-characters", { headers: headers() }) },
        { name: "/api/saved-styles", run: () => fetch("/api/saved-styles", { headers: headers() }) },
        { name: "/api/get-user-voice-clones", run: () => fetch("/api/get-user-voice-clones", { headers: headers() }) },
        { name: "/api/get-user-custom-music", run: () => fetch("/api/get-user-custom-music", { headers: headers() }) },
        { name: "/api/organizations/credits", run: () => fetch("/api/organizations/credits", { headers: headers() }) },
        { name: "/api/avatars", run: () => fetch("/api/avatars", { headers: headers() }) },
        { name: "/api/stock-avatars", run: () => fetch("/api/stock-avatars", { headers: headers() }) },
        { name: "/api/changelogs?page=1&page_size=3", run: () => fetch("/api/changelogs?page=1&page_size=3", { headers: headers() }) },
        { name: "/api/get-subscription-details", run: () => fetch("/api/get-subscription-details", { method: "POST", headers: headers() }) },
        { name: "/api/active-subscriptions", run: () => fetch("/api/active-subscriptions", { headers: headers() }) },
      ];

      const results = await Promise.all(
        calls.map(async (call) => {
          try {
            const response = await call.run();
            let detail = `HTTP ${response.status}`;
            const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
            if (Array.isArray(data.characters)) detail = `${(data.characters as unknown[]).length} characters`;
            else if (Array.isArray(data.styles)) detail = `${(data.styles as unknown[]).length} styles`;
            else if (Array.isArray(data.voice_clones)) detail = `${(data.voice_clones as unknown[]).length} voices`;
            else if (Array.isArray(data.custom_music)) detail = `${(data.custom_music as unknown[]).length} tracks`;
            else if (Array.isArray(data.organizations)) detail = `${(data.organizations as unknown[]).length} orgs`;
            else if (Array.isArray(data.avatars)) detail = `${(data.avatars as unknown[]).length} avatars`;
            else if (Array.isArray(data.changelogs)) detail = `${(data.changelogs as unknown[]).length} entries`;
            else if (data.mocked) detail = "mocked";
            return { name: call.name, ok: response.ok, detail };
          } catch {
            return { name: call.name, ok: false, detail: "unreachable" };
          }
        }),
      );
      if (!cancelled) setStartup(results);

      try {
        const [avatarsResponse, musicResponse, charactersResponse] = await Promise.all([
          fetch("/api/stock-avatars", { headers: headers() }),
          fetch("/api/get-user-custom-music", { headers: headers() }),
          fetch("/api/get-user-characters", { headers: headers() }),
        ]);
        if (avatarsResponse.ok) {
          const data = (await avatarsResponse.json()) as { avatars?: StockAvatar[] };
          if (!cancelled) setStockAvatars(data.avatars ?? []);
        }
        if (musicResponse.ok) {
          const data = (await musicResponse.json()) as { custom_music?: CustomMusic[] };
          if (!cancelled) setMusic(data.custom_music ?? []);
        }
        if (charactersResponse.ok) {
          const data = (await charactersResponse.json()) as { characters?: Character[] };
          if (!cancelled) setCharacters(data.characters ?? []);
        }
      } catch {
        // Optional UI data.
      }

      if (!cancelled) await loadRecent();
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [headers, loadRecent]);

  const pollJob = useCallback(
    async (jobId: string, videoId: string | null) => {
      pollAbort.current = false;
      const startedAt = Date.now();
      let state: JobState = {
        jobId,
        videoId,
        status: "queued",
        stage: "queued",
        progress: 0,
        script: null,
        video: null,
        variants: [],
        error: null,
      };
      setJob(state);

      while (!pollAbort.current) {
        let payload: Record<string, unknown> | null = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const response = await fetchWithRetry(
              "/api/generate/poll",
              {
                method: "POST",
                headers: { "content-type": "application/json", ...headers() },
                body: JSON.stringify({ job_id: jobId, video_id: videoId }),
              },
              1,
              30_000,
            );
            if (response.ok) {
              payload = (await response.json()) as Record<string, unknown>;
              break;
            }
          } catch {
            // retry once
          }
        }

        if (payload) {
          state = {
            jobId,
            videoId: (payload.video_id as string) ?? videoId,
            status: String(payload.status ?? "processing"),
            stage: String(payload.stage ?? "processing"),
            progress: Number(payload.progress ?? 0),
            script: (payload.script as string) ?? state.script,
            video: (payload.video as Video) ?? state.video,
            variants: (payload.variant_video_ids as string[]) ?? state.variants,
            error: (payload.error as string) ?? null,
          };
          setJob(state);

          if (state.status === "ready" || state.status === "script_ready") {
            localStorage.removeItem(LAST_GENERATION_KEY);
            await loadRecent();
            setNotice({
              kind: "ok",
              text:
                state.status === "script_ready"
                  ? "Script ready — it is shown below."
                  : "Render complete — the video is now in your library.",
            });
            return;
          }
          if (state.status === "failed") {
            localStorage.removeItem(LAST_GENERATION_KEY);
            setNotice({ kind: "error", text: state.error ?? "Generation failed." });
            return;
          }
        }

        // The report caps unknown-kind polling at 10 minutes.
        if (Date.now() - startedAt > 10 * 60 * 1000) {
          setNotice({ kind: "error", text: "Generation is taking longer than expected." });
          return;
        }
        await sleep(1200);
      }
    },
    [headers, loadRecent],
  );

  // Resume an interrupted generation (localStorage["golpo:lastGeneration"]).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_GENERATION_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        pending?: boolean;
        jobId?: string;
        videoId?: string | null;
        startedAt?: number;
      };
      if (!saved.pending || !saved.jobId) return;
      if (saved.startedAt && Date.now() - saved.startedAt > 30 * 60 * 1000) {
        localStorage.removeItem(LAST_GENERATION_KEY);
        return;
      }
      void pollJob(saved.jobId, saved.videoId ?? null);
    } catch {
      // Ignore malformed entries.
    }
  }, [pollJob]);

  useEffect(() => () => {
    pollAbort.current = true;
  }, []);

  function toggleVariant(code: string) {
    setVariants((current) => {
      if (current.includes(code)) return current.filter((entry) => entry !== code);
      if (current.length >= 10) {
        setNotice({ kind: "error", text: "A maximum of 10 language variants is supported." });
        return current;
      }
      return [...current, code];
    });
  }

  function toggleCharacter(id: string) {
    setSelectedCharacters((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  async function importScript(file: File) {
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetch("/api/extract-script-source", {
        method: "POST",
        headers: headers(),
        body: form,
      });
      const data = (await response.json()) as {
        text?: string;
        error?: string;
        word_count?: number;
        source_type?: string;
        language?: string | null;
        words?: Array<{ word: string; start: number; end: number }>;
      };
      if (!response.ok || !data.text) {
        setNotice({ kind: "error", text: data.error ?? "Could not read that file." });
        return;
      }
      setPrompt(data.text.slice(0, 8000));
      const detail =
        data.source_type === "audio"
          ? `Transcribed ${data.word_count ?? 0} words${data.language ? ` (${data.language})` : ""} with ${data.words?.length ?? 0} word timestamps`
          : `Imported ${data.word_count ?? 0} words`;
      setNotice({ kind: "ok", text: `${detail} from ${file.name}.` });
    } catch {
      setNotice({ kind: "error", text: "Import failed." });
    }
  }

  async function generate() {
    if (!prompt.trim()) {
      setNotice({ kind: "error", text: "Describe the video you want to create." });
      return;
    }
    setBusy(true);
    setNotice(null);
    pollAbort.current = true; // stop any previous loop
    setJob(null);

    try {
      const form = new FormData();
      form.set("prompt", prompt.trim());
      form.set("kind", kind);
      form.set("use_2_0_style", String(engine === "golpo_canvas"));
      form.set("use_lineart_2_style", String(engine === "golpo_sketch"));
      form.set("image_style", canvasStyle);
      form.set("pen_style", sketchStyle);
      form.set("image_generation_model", "default");
      form.set("use_color", String(color));
      form.set("pacing", pacing);
      form.set("video_orientation", orientation);
      form.set("durationSeconds", String(duration));
      form.set("language", language);
      form.set("display_language", languageName(language));
      form.set("voiceName", voice);
      form.set("fill_in", String(fillIn));
      form.set("characters", JSON.stringify(selectedCharacters));
      form.set("avatar_renderer", aiPresenter ? "studio" : "");
      form.set("avatar_presentation_mode", aiPresenter ? "half_body" : "");
      form.set("just_return_script", String(scriptOnly));
      form.set("include_watermark", String(watermark));
      form.set("force_watermark", String(watermark));
      form.set("is_audio_only", String(kind === "podcast"));
      form.set("variant_languages", JSON.stringify(variants));
      form.set("variant_display_languages", JSON.stringify(variants.map(languageName)));
      if (ownNarration) {
        form.set("own_narration_avatar_id", ownNarrationAvatar || stockAvatars[0]?.id || "stock_ava");
        form.set("own_narration_pip_position", "bottom_right");
        form.set("own_narration_video_mode", "pip");
      }
      if (musicId) {
        const track = music.find((entry) => entry.id === musicId);
        if (track) {
          form.set("custom_music_url", track.url);
          form.set("musicName", track.name);
        }
      }
      for (const file of files) form.append("media_files", file);

      const response = await fetchWithRetry(
        "/api/generate",
        { method: "POST", headers: headers(), body: form },
        3,
        60_000,
      );
      const data = (await response.json()) as {
        error?: string;
        job_id?: string;
        video_id?: string | null;
        script?: string;
        status?: string;
      };

      if (!response.ok || !data.job_id) {
        setNotice({
          kind: "error",
          text:
            response.status === 402
              ? "You don't have enough credits. (Billing is mocked locally — this should not happen.)"
              : data.error ?? "Generation could not be started.",
        });
        return;
      }

      localStorage.setItem(
        LAST_GENERATION_KEY,
        JSON.stringify({
          startedAt: Date.now(),
          pending: true,
          jobId: data.job_id,
          videoId: data.video_id ?? null,
          isScriptGeneration: scriptOnly,
          isAudioOnly: kind === "podcast",
          variantVideoIds: [],
        }),
      );

      setNotice({
        kind: "ok",
        text: scriptOnly ? "Script generation started." : "Render queued. Polling for progress…",
      });
      await pollJob(data.job_id, data.video_id ?? null);
    } catch {
      setNotice({ kind: "error", text: "The local server did not respond. Check the dev terminal." });
    } finally {
      setBusy(false);
    }
  }

  const styles = engine === "golpo_canvas" ? CANVAS_STYLES : SKETCH_STYLES;
  const activeStyle = engine === "golpo_canvas" ? canvasStyle : sketchStyle;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 30 }}>Playground</h1>
          <p>
            {email} · everything unlocked. Renders run locally with FFmpeg, and jobs, polling and
            the library behave like the real dashboard.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="credits-pill">
            <span className="status-dot" />
            {credits.toLocaleString()} credits
          </span>
          <span className="badge badge-warn">Billing mocked</span>
        </div>
      </div>

      <div className="split">
        <div className="card">
          <div className="card-title">
            <h3>Create</h3>
            <span className="badge badge-accent">{kind === "podcast" ? "Podcast" : "Video"}</span>
          </div>

          <div className="field">
            <label className="label" htmlFor="prompt">
              Prompt or script
            </label>
            <textarea
              id="prompt"
              className="textarea"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Explain how photosynthesis works for a 12-year-old, in a friendly whiteboard style…"
            />
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label className="btn btn-sm" style={{ cursor: "pointer" }}>
                Import script or audio
                <input
                  type="file"
                  accept=".txt,.md,.srt,.vtt,.csv,.json,.html,.pdf,.docx,.mp3,.wav,.m4a,.ogg,.webm,.flac,.mp4"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importScript(file);
                    event.target.value = "";
                  }}
                />
              </label>
              <span className="hint">{prompt.length}/8000 characters</span>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <span className="label">Format</span>
              <select
                className="select"
                value={kind}
                onChange={(event) => setKind(event.target.value as "video" | "podcast")}
              >
                <option value="video">Video</option>
                <option value="podcast">Audio only (podcast)</option>
              </select>
            </div>
            <div className="field">
              <span className="label">Engine</span>
              <select
                className="select"
                value={engine}
                onChange={(event) =>
                  setEngine(event.target.value as "golpo_canvas" | "golpo_sketch")
                }
              >
                <option value="golpo_canvas">Golpo Canvas</option>
                <option value="golpo_sketch">Golpo Sketch</option>
              </select>
            </div>
            <div className="field">
              <span className="label">Duration · {duration}s</span>
              <input
                className="input"
                type="range"
                min={DURATION_LIMITS.minSeconds}
                max={300}
                step={15}
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
              />
            </div>
            <div className="field">
              <span className="label">Orientation</span>
              <select
                className="select"
                value={orientation}
                onChange={(event) =>
                  setOrientation(event.target.value as "16:9" | "9:16" | "1:1")
                }
              >
                <option value="16:9">Landscape · 16:9</option>
                <option value="9:16">Portrait · 9:16</option>
                <option value="1:1">Square · 1:1</option>
              </select>
            </div>
          </div>

          <div className="field">
            <span className="label">Style · {activeStyle.replace(/_/g, " ")}</span>
            <div className="chips">
              {styles.map((style) => (
                <button
                  key={style}
                  type="button"
                  className="chip"
                  data-active={
                    activeStyle === style
                  }
                  onClick={() =>
                    engine === "golpo_canvas"
                      ? setCanvasStyle(style)
                      : setSketchStyle(style)
                  }
                >
                  {style.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <span className="label">Narration language</span>
              <select
                className="select"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                {LANGUAGES.map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span className="label">Voice</span>
              <select
                className="select"
                value={voice}
                onChange={(event) => setVoice(event.target.value)}
              >
                {VOICES.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} · {entry.accent}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span className="label">Pacing</span>
              <select
                className="select"
                value={pacing}
                onChange={(event) => setPacing(event.target.value)}
              >
                {PACING.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <span className="label">Language variants ({variants.length}/10)</span>
            <div className="chips" style={{ maxHeight: 120, overflow: "auto" }}>
              {LANGUAGES.filter((entry) => entry.code !== language).map((entry) => (
                <button
                  key={entry.code}
                  type="button"
                  className="chip"
                  data-active={variants.includes(entry.code)}
                  onClick={() => toggleVariant(entry.code)}
                >
                  {entry.name}
                </button>
              ))}
            </div>
          </div>

          {characters.length > 0 ? (
            <div className="field">
              <span className="label">Characters ({selectedCharacters.length})</span>
              <div className="chips" style={{ maxHeight: 120, overflow: "auto" }}>
                {characters.map((character) => (
                  <button
                    key={character.id}
                    type="button"
                    className="chip"
                    data-active={selectedCharacters.includes(character.id)}
                    onClick={() => toggleCharacter(character.id)}
                  >
                    {character.name}
                  </button>
                ))}
              </div>
              <span className="hint">
                Selected characters are kept consistent across scene artwork.
              </span>
            </div>
          ) : null}

          <div className="toggle-grid" style={{ marginBottom: 16 }}>
            <label className="check">
              <input
                type="checkbox"
                checked={color}
                onChange={(event) => setColor(event.target.checked)}
              />
              <span>
                Colour
                <small>Unlocked locally</small>
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={watermark}
                onChange={(event) => setWatermark(event.target.checked)}
              />
              <span>
                Watermark
                <small>Off by default</small>
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={scriptOnly}
                onChange={(event) => setScriptOnly(event.target.checked)}
              />
              <span>
                Script only
                <small>Skip rendering</small>
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={fillIn}
                onChange={(event) => setFillIn(event.target.checked)}
              />
              <span>
                Fill in to duration
                <small>Expands a pasted script</small>
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={aiPresenter}
                onChange={(event) => setAiPresenter(event.target.checked)}
              />
              <span>
                AI presenter
                <small>Creator tier normally</small>
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={ownNarration}
                onChange={(event) => setOwnNarration(event.target.checked)}
              />
              <span>
                Own narration
                <small>Business tier normally</small>
              </span>
            </label>
          </div>

          {ownNarration ? (
            <div className="field">
              <span className="label">Presenter avatar</span>
              <select
                className="select"
                value={ownNarrationAvatar}
                onChange={(event) => setOwnNarrationAvatar(event.target.value)}
              >
                {(stockAvatars.length > 0
                  ? stockAvatars
                  : [{ id: "stock_ava", name: "Ava", renderer: "studio" }]
                ).map((avatar) => (
                  <option key={avatar.id} value={avatar.id}>
                    {avatar.name} · {avatar.renderer}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {music.length > 0 ? (
            <div className="field">
              <span className="label">Custom music</span>
              <select
                className="select"
                value={musicId}
                onChange={(event) => setMusicId(event.target.value)}
              >
                <option value="">No custom music</option>
                {music.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="field">
            <span className="label">Reference files</span>
            <input
              className="input"
              type="file"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
            <span className="hint">
              Images, clips or audio, up to 15 MB each. Stored under .data/uploads.
            </span>
          </div>

          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => void generate()}
            disabled={busy}
          >
            {busy ? (
              <>
                <span className="spin" /> {scriptOnly ? "Writing script…" : "Generating…"}
              </>
            ) : scriptOnly ? (
              "Write the script"
            ) : (
              "Generate video"
            )}
          </button>
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <div className="card">
            <div className="card-title">
              <h3>Render</h3>
              {job ? (
                <span className={`badge ${job.status === "ready" || job.status === "script_ready" ? "badge-ok" : "badge-accent"}`}>
                  {job.status.replace(/_/g, " ")}
                </span>
              ) : (
                <span className="badge">Idle</span>
              )}
            </div>

            {job ? (
              <>
                <div className="progress-label">
                  <span style={{ textTransform: "capitalize" }}>{describeStage(job.stage)}</span>
                  <span>{job.progress}%</span>
                </div>
                <div className="progress">
                  <span style={{ width: `${Math.max(3, job.progress)}%` }} />
                </div>

                {job.video && job.status === "ready" ? (
                  <div style={{ marginTop: 16 }}>
                    <div className="video-frame">
                      {job.video.media_format === "mp4" ? (
                        // eslint-disable-next-line jsx-a11y/media-has-caption
                        <video
                          src={job.video.video_url ?? `/api/media/${job.video.id}/preview`}
                          poster={job.video.poster_url ?? `/api/media/${job.video.id}/poster`}
                          controls
                          playsInline
                          preload="metadata"
                        />
                      ) : (
                        <>
                          {/* Storyboard fallback: an animated SVG preview. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={job.video.video_url ?? `/api/media/${job.video.id}/preview`}
                            alt=""
                          />
                        </>
                      )}
                    </div>
                    <div style={{ marginTop: 12, fontWeight: 600 }}>{job.video.title}</div>
                    <div className="media-meta" style={{ marginTop: 6 }}>
                      <span>{job.video.style.replace(/_/g, " ")}</span>
                      <span>{job.video.duration_seconds}s</span>
                      <span>{job.video.display_language}</span>
                      {job.video.watermark ? <span>watermarked</span> : null}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                      <Link href={`/v/${job.video.id}`} className="btn btn-sm">
                        Open detail
                      </Link>
                      <a
                        className="btn btn-sm"
                        href={`/api/media/${job.video.id}/poster`}
                        download
                      >
                        Download poster
                      </a>
                      {job.video.media_format === "mp4" ? (
                        <a
                          className="btn btn-sm"
                          href={`/api/media/${job.video.id}/preview`}
                          download
                        >
                          Download video
                        </a>
                      ) : null}
                    </div>
                    {job.variants.length > 0 ? (
                      <div style={{ marginTop: 14 }}>
                        <span className="label">Language variants</span>
                        <div className="chips" style={{ marginTop: 8 }}>
                          {job.variants.map((variantId) => (
                            <Link key={variantId} href={`/v/${variantId}`} className="chip">
                              {variantId.slice(-6)}
                            </Link>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : job.script && job.status === "script_ready" ? (
                  <div style={{ marginTop: 16 }}>
                    <span className="label">Generated script</span>
                    <div className="script-box" style={{ marginTop: 8 }}>
                      {job.script}
                    </div>
                  </div>
                ) : (
                  <div className="empty" style={{ marginTop: 16 }}>
                    <strong style={{ color: "var(--text)" }}>{describeStage(job.stage)}</strong>
                    <p style={{ margin: "8px 0 0", fontSize: 13 }}>
                      Job <span className="mono">{job.jobId}</span>
                    </p>
                  </div>
                )}

                {job.script && job.status === "ready" ? (
                  <details style={{ marginTop: 16 }}>
                    <summary className="label" style={{ cursor: "pointer" }}>
                      Show script
                    </summary>
                    <div className="script-box" style={{ marginTop: 8 }}>
                      {job.script}
                    </div>
                  </details>
                ) : null}
              </>
            ) : (
              <div className="empty">
                Nothing rendering yet. Describe an idea and press{" "}
                <strong style={{ color: "var(--text)" }}>Generate</strong>.
              </div>
            )}

            {notice ? (
              <div className={`toast ${notice.kind === "ok" ? "ok" : ""}`}>{notice.text}</div>
            ) : null}
          </div>

          <div className="card card-tight">
            <div className="card-title">
              <h3>Recent videos</h3>
              <Link href="/library" className="btn btn-sm">
                Library
              </Link>
            </div>
            {recent.length === 0 ? (
              <div className="empty" style={{ padding: 24 }}>
                No videos yet.
              </div>
            ) : (
              <div className="list">
                {recent.map((video) => (
                  <div className="list-row" key={video.id}>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontWeight: 600,
                        }}
                      >
                        {video.title}
                      </div>
                      <div className="hint">
                        {video.duration_seconds}s · {video.style.replace(/_/g, " ")}
                      </div>
                    </div>
                    <Link href={`/v/${video.id}`} className="btn btn-sm">
                      Open
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card card-tight">
            <div className="card-title">
              <h3>Startup BFF calls</h3>
              <span className="badge">{startup.filter((call) => call.ok).length}/{startup.length || 11}</span>
            </div>
            <div className="list">
              {startup.length === 0 ? (
                <div className="hint">Loading…</div>
              ) : (
                startup.map((call) => (
                  <div className="list-row" key={call.name} style={{ padding: "8px 11px" }}>
                    <span className="mono" style={{ fontSize: 11.5 }}>
                      {call.name}
                    </span>
                    <span className={`badge ${call.ok ? "badge-ok" : "badge-danger"}`}>
                      {call.detail}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
