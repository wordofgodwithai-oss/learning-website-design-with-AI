#!/usr/bin/env node
/**
 * End-to-end smoke test for the local Golpo clone.
 *
 * Usage:
 *   node scripts/smoke.mjs                 # against http://localhost:3000
 *   GOLPO_BASE_URL=http://localhost:3000 node scripts/smoke.mjs
 *   GOLPO_API_KEY=glp_... node scripts/smoke.mjs
 *
 * Requires the dev server to be running (`npm run dev`).
 */

const BASE = (process.env.GOLPO_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const API_KEY = process.env.GOLPO_API_KEY ?? "glp_local_dev_key_change_me";
const POLL_TIMEOUT_MS = Number(process.env.GOLPO_SMOKE_POLL_MS ?? 180_000);

let failures = 0;
let cookie = "";

function ok(name, detail = "") {
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

function bad(name, detail = "") {
  failures += 1;
  console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

function check(condition, name, detail = "") {
  if (condition) ok(name, detail);
  else bad(name, detail);
}

function headers(extra = {}) {
  return { ...(cookie ? { cookie } : {}), ...extra };
}

async function call(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, { ...init, headers: headers(init.headers) });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    const session = setCookie.split(";").find((part) => part.trim().startsWith("golpo_session="));
    if (session) cookie = session.trim();
  }
  return response;
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function waitForJob(path, jobId, bearer) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const response = await call(path, {
      method: path.includes("/api/generate/poll") ? "POST" : "GET",
      headers: {
        ...(path.includes("/api/generate/poll")
          ? { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }
          : { "x-api-key": API_KEY, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }),
      },
      ...(path.includes("/api/generate/poll")
        ? { body: JSON.stringify({ job_id: jobId }) }
        : {}),
    });
    const data = await readJsonSafe(response);
    if (!response.ok) throw new Error(`poll ${response.status}: ${JSON.stringify(data)}`);
    last = data;
    if (data?.status === "ready" || data?.status === "script_ready") return data;
    if (data?.status === "failed") throw new Error(data.error ?? "job failed");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`timed out waiting for ${jobId} (last: ${JSON.stringify(last)})`);
}

async function main() {
  console.log(`\nGolpo local smoke test → ${BASE}\n`);

  // 1. Landing page
  const home = await call("/");
  const homeHtml = await home.text();
  check(home.status === 200, "GET /", `HTTP ${home.status}`);
  check(
    homeHtml.includes("Continue with the demo account") || homeHtml.includes("Open playground"),
    "landing page renders sign-in or dashboard",
  );

  // 1b. Health
  const health = await call("/api/health");
  const healthData = await readJsonSafe(health);
  check(health.status === 200, "GET /api/health", `HTTP ${health.status}`);
  check(healthData?.integrations?.auth === "mysql", "health reports MySQL", healthData?.integrations?.auth);

  // 2. Sign in (demo account)
  const signIn = await call("/api/auth/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "dev", redirect: "/playground" }),
  });
  const signInData = await readJsonSafe(signIn);
  check(signIn.status === 200, "POST /api/auth/sign-in", `HTTP ${signIn.status}`);
  check(Boolean(signInData?.access_token), "access token issued");
  check(signInData?.credits === 999_999, "infinite mock credits", String(signInData?.credits));
  check(Boolean(cookie), "session cookie set");
  const token = signInData?.access_token;
  if (!token) throw new Error("cannot continue without an access token");

  // 3. Session + playground
  const session = await call("/api/auth/session");
  const sessionData = await readJsonSafe(session);
  check(sessionData?.authenticated === true, "GET /api/auth/session");

  const playground = await call("/playground");
  const playgroundHtml = await playground.text();
  check(playground.status === 200, "GET /playground", `HTTP ${playground.status}`);
  check(playgroundHtml.includes("Playground"), "playground renders");

  // 4. Startup BFF calls
  const startup = [
    ["POST", "/api/referral"],
    ["GET", "/api/get-user-characters"],
    ["GET", "/api/saved-styles"],
    ["GET", "/api/get-user-voice-clones"],
    ["GET", "/api/get-user-custom-music"],
    ["GET", "/api/organizations/credits"],
    ["GET", "/api/avatars"],
    ["GET", "/api/stock-avatars"],
    ["GET", "/api/changelogs?page=1&page_size=3"],
    ["POST", "/api/get-subscription-details"],
    ["GET", "/api/active-subscriptions"],
  ];
  let startupOk = 0;
  for (const [method, path] of startup) {
    const response = await call(path, { method, headers: { authorization: `Bearer ${token}` } });
    if (response.ok) startupOk += 1;
    else bad(`startup ${method} ${path}`, `HTTP ${response.status}`);
  }
  check(startupOk === startup.length, `startup BFF contract (${startupOk}/${startup.length})`);

  // 5. Browser-path generation (multipart + bearer)
  const form = new FormData();
  form.set("prompt", "Explain why the sky is blue for a curious 12 year old.");
  form.set("kind", "video");
  form.set("image_style", "whiteboard");
  form.set("pen_style", "classic");
  form.set("durationSeconds", "30");
  form.set("language", "en");
  form.set("display_language", "English");
  form.set("variant_languages", JSON.stringify(["es", "fr"]));

  const generate = await call("/api/generate", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const generateData = await readJsonSafe(generate);
  check(generate.status === 200, "POST /api/generate", `HTTP ${generate.status}`);
  check(Boolean(generateData?.job_id), "job created", generateData?.job_id);
  check(Boolean(generateData?.script), "script written");

  const finished = await waitForJob("/api/generate/poll", generateData.job_id, token);
  check(finished?.status === "ready", "job reaches ready", finished?.status);
  check(finished?.progress === 100, "progress reaches 100", String(finished?.progress));
  check(Boolean(finished?.video?.video_url), "video url set", finished?.video?.video_url);
  check(
    (finished?.variant_video_ids ?? []).length === 2,
    "language variants created",
    String((finished?.variant_video_ids ?? []).length),
  );

  // 6. Rendered media (MP4 when FFmpeg is available, animated SVG otherwise)
  const preview = await call(`/api/media/${finished.video.id}/preview`);
  const previewType = preview.headers.get("content-type") ?? "";
  const previewBytes = Buffer.from(await preview.arrayBuffer());
  check(preview.ok && previewBytes.length > 1000, "preview asset served", `${previewType} ${previewBytes.length}B`);
  check(
    previewType.startsWith("video/mp4") || previewType.startsWith("image/svg"),
    "preview is mp4 or svg",
    previewType,
  );

  if (previewType.startsWith("video/mp4")) {
    const ranged = await fetch(`${BASE}/api/media/${finished.video.id}/preview`, {
      headers: { range: "bytes=0-1023" },
    });
    const rangedBytes = Buffer.from(await ranged.arrayBuffer());
    check(
      ranged.status === 206 && rangedBytes.length === 1024,
      "mp4 supports byte ranges",
      `HTTP ${ranged.status} ${rangedBytes.length}B`,
    );
    check(
      finished.video.media_format === "mp4",
      "video row records mp4 format",
      String(finished.video.media_format),
    );
  }

  const poster = await call(`/api/media/${finished.video.id}/poster`);
  const posterType = poster.headers.get("content-type") ?? "";
  const posterBytes = Buffer.from(await poster.arrayBuffer());
  check(
    poster.ok && posterBytes.length > 500,
    "poster asset served",
    `${posterType} ${posterBytes.length}B`,
  );
  check(
    posterType.startsWith("image/jpeg") || posterType.startsWith("image/svg"),
    "poster is jpeg or svg",
    posterType,
  );

  // 7. Library
  const videos = await call("/api/videos?limit=10", {
    headers: { authorization: `Bearer ${token}` },
  });
  const videosData = await readJsonSafe(videos);
  check(Array.isArray(videosData?.videos) && videosData.videos.length > 0, "GET /api/videos");

  // 8. Public API v1 (x-api-key)
  const v1Form = new FormData();
  v1Form.set("prompt", "Explain DNS in one minute.");
  v1Form.set("durationSeconds", "15");
  v1Form.set("language", "en");
  const v1Generate = await call("/api/v1/videos/generate", {
    method: "POST",
    headers: { "x-api-key": API_KEY },
    body: v1Form,
  });
  const v1Data = await readJsonSafe(v1Generate);
  check(v1Generate.status === 202, "POST /api/v1/videos/generate", `HTTP ${v1Generate.status}`);
  check(Boolean(v1Data?.job_id), "v1 job created", v1Data?.job_id);

  if (v1Data?.job_id) {
    const v1Done = await waitForJob(
      `/api/v1/videos/status/${v1Data.job_id}`,
      v1Data.job_id,
    );
    check(v1Done?.status === "ready", "v1 job reaches ready");
  }

  const v1List = await call("/api/v1/videos", { headers: { "x-api-key": API_KEY } });
  const v1ListData = await readJsonSafe(v1List);
  check(v1List.ok && Array.isArray(v1ListData?.videos), "GET /api/v1/videos");

  // 9. Public API v2 (JSON)
  const v2Generate = await call("/api/v2/videos/generate", {
    method: "POST",
    headers: { "x-api-key": API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "Explain photosynthesis",
      kind: "video",
      golpo_video_engine: "golpo_sketch",
      sketch_style_variant: "crayon",
      duration_seconds: 15,
      narration_language: "en",
    }),
  });
  const v2Data = await readJsonSafe(v2Generate);
  check(v2Generate.status === 202, "POST /api/v2/videos/generate", `HTTP ${v2Generate.status}`);
  check(Boolean(v2Data?.job_id), "v2 job created", v2Data?.job_id);

  // 10. MCP
  const mcpList = await call("/api/mcp", {
    method: "POST",
    headers: { "x-api-key": API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const mcpListData = await readJsonSafe(mcpList);
  check(
    mcpList.ok && mcpListData?.result?.tools?.length === 6,
    "MCP tools/list returns 6 tools",
  );

  const mcpCall = await call("/api/mcp", {
    method: "POST",
    headers: { "x-api-key": API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "generate_video",
        arguments: { prompt: "What is an API?", duration_seconds: 15, script_only: true },
      },
    }),
  });
  const mcpCallData = await readJsonSafe(mcpCall);
  check(
    mcpCall.ok && Boolean(mcpCallData?.result?.structuredContent?.job_id),
    "MCP tools/call generate_video",
  );

  // 11. Unauthenticated access is rejected
  const unauthorized = await fetch(`${BASE}/api/videos`);
  check(unauthorized.status === 401, "unauthenticated BFF call rejected", `HTTP ${unauthorized.status}`);

  const badKey = await fetch(`${BASE}/api/v1/videos`, { headers: { "x-api-key": "nope" } });
  check(badKey.status === 401, "invalid API key rejected", `HTTP ${badKey.status}`);

  // 12. Email + password accounts (MySQL)
  const smokeEmail = `smoke+${Date.now()}@golpo.local`;
  const smokePassword = "smoke-test-password";

  const signUp = await call("/api/auth/sign-up", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: smokeEmail, password: smokePassword, name: "Smoke Test" }),
  });
  const signUpData = await readJsonSafe(signUp);
  check(signUp.status === 201, "POST /api/auth/sign-up", `HTTP ${signUp.status}`);
  check(Boolean(signUpData?.access_token), "sign-up issues a session");

  const duplicate = await call("/api/auth/sign-up", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: smokeEmail, password: smokePassword }),
  });
  check(duplicate.status === 409, "duplicate sign-up rejected", `HTTP ${duplicate.status}`);

  const signOut = await call("/api/auth/sign-out", { method: "POST" });
  check(signOut.status === 200, "POST /api/auth/sign-out", `HTTP ${signOut.status}`);

  const signedOutSession = await call("/api/auth/session");
  const signedOutData = await readJsonSafe(signedOutSession);
  check(signedOutData?.authenticated === false, "sign-out revokes the session");

  const passwordSignIn = await call("/api/auth/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: smokeEmail, password: smokePassword }),
  });
  const passwordSignInData = await readJsonSafe(passwordSignIn);
  check(passwordSignIn.status === 200, "password sign-in", `HTTP ${passwordSignIn.status}`);
  check(Boolean(passwordSignInData?.access_token), "password sign-in issues a session");

  const passwordSession = await call("/api/auth/session");
  const passwordSessionData = await readJsonSafe(passwordSession);
  check(passwordSessionData?.authenticated === true, "password session is authenticated");

  const wrongPassword = await call("/api/auth/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: smokeEmail, password: "not-the-password" }),
  });
  check(wrongPassword.status === 401, "wrong password rejected", `HTTP ${wrongPassword.status}`);

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nSmoke test crashed: ${error.message}\n`);
  process.exit(1);
});
