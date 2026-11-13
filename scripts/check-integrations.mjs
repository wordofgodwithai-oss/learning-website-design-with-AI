#!/usr/bin/env node
/**
 * Integration preflight.
 *
 * Reads `.env.local` (values never leave this process) and reports which
 * capabilities are configured, which are still on the local fallback, and the
 * exact next action for each missing one.
 *
 *   npm run integrations:check
 *   npm run integrations:check -- --strict   # exit 1 if anything is missing
 *
 * This mirrors the resolution rules in src/lib/integrations.ts. It does not
 * call any provider, so it is safe to run without keys and costs nothing.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const STRICT = process.argv.includes("--strict");
const root = process.cwd();
const envPath = path.join(root, ".env.local");

/** Minimal dotenv parser: KEY=value, ignores comments and surrounding quotes. */
function readEnvFile(file) {
  const values = {};
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

// .env.local wins over the ambient environment, matching Next.js precedence.
const env = { ...process.env, ...readEnvFile(envPath) };
const get = (key) => (env[key] ?? "").trim();
const has = (key) => get(key).length > 0;

function mode(key, automatic, allowed) {
  const value = get(key).toLowerCase();
  if (!value || value === "auto") return automatic;
  return allowed.includes(value) ? value : automatic;
}

const checks = [];
function check(level, area, message) {
  checks.push({ level, area, message });
}

// ---------------------------------------------------------------------------
// Groq (scripts, transcription, narration)
// ---------------------------------------------------------------------------
const groqKey = get("GROQ_API_KEY");
const groqBase = get("GROQ_BASE_URL") || "https://api.groq.com/openai/v1";
const scriptMode = mode("GOLPO_SCRIPT_MODE", groqKey ? "groq" : "local", ["local", "groq"]);
const ttsMode = mode("GOLPO_TTS_MODE", groqKey ? "groq" : "edge", ["none", "groq", "edge"]);
const transcriptionMode = mode("GOLPO_TRANSCRIBE_MODE", groqKey ? "groq" : "none", [
  "none",
  "groq",
]);

if (!groqKey) {
  check(
    "missing",
    "Groq",
    "GROQ_API_KEY is not set — scripts stay local, transcription is disabled and narration uses Edge voices.",
  );
} else if (groqKey === "stub-key" || groqKey.startsWith("stub")) {
  check(
    "warn",
    "Groq",
    `Using a stub key against ${groqBase}. Fine for local tests, not for real scripts.`,
  );
} else if (!groqKey.startsWith("gsk_")) {
  check("warn", "Groq", "GROQ_API_KEY does not look like a Groq key (expected gsk_...).");
} else {
  check(
    "ok",
    "Groq",
    `Scripts: ${scriptMode}, transcription: ${transcriptionMode}, narration: ${ttsMode} (${groqBase}).`,
  );
}
if (get("OPENAI_API_KEY")) {
  check(
    "warn",
    "Groq",
    "OPENAI_API_KEY is set but unused. This app calls Groq only; remove it from .env.local.",
  );
}
if (groqKey && groqBase !== "https://api.groq.com/openai/v1") {
  check("warn", "Groq", `Custom endpoint in use: ${groqBase}. Only do this for compatible gateways.`);
}

// ---------------------------------------------------------------------------
// MySQL
// ---------------------------------------------------------------------------
const dbHost = get("GOLPO_DB_HOST") || "127.0.0.1";
const dbPort = get("GOLPO_DB_PORT") || "3306";
const dbUser = get("GOLPO_DB_USER") || "root";
const dbName = get("GOLPO_DB_NAME") || "golpo";

check(
  "info",
  "MySQL",
  `Target: ${dbUser}@${dbHost}:${dbPort}/${dbName}. Run \`npm run db:setup\` to create it.`,
);

try {
  const mysql = await import("mysql2/promise");
  const connection = await mysql.createConnection({
    host: dbHost,
    port: Number(dbPort) || 3306,
    user: dbUser,
    password: get("GOLPO_DB_PASSWORD"),
    database: dbName,
    connectTimeout: 4_000,
  });
  try {
    const [result] = await connection.query(
      "SELECT (SELECT COUNT(*) FROM `users`) AS users, (SELECT COUNT(*) FROM `videos`) AS videos",
    );
    check(
      "ok",
      "MySQL",
      `Connected — ${result[0].users} users, ${result[0].videos} videos in \`${dbName}\`.`,
    );
  } finally {
    await connection.end();
  }
} catch (error) {
  check(
    "missing",
    "MySQL",
    `Could not connect: ${error.message}. Is WAMP running and has \`npm run db:setup\` been run?`,
  );
}

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------
const stripeKey = get("STRIPE_SECRET_KEY");
const billingMode = mode("GOLPO_BILLING_MODE", stripeKey ? "stripe" : "mock", ["mock", "stripe"]);
const unlimitedDev = ["1", "true", "yes", "on"].includes(get("GOLPO_UNLIMITED_DEV").toLowerCase());

if (!stripeKey) {
  check("missing", "Stripe", "STRIPE_SECRET_KEY is not set — billing stays mocked (999,999 credits).");
} else if (stripeKey.startsWith("sk_live_")) {
  check(
    "warn",
    "Stripe",
    "LIVE key detected. Checkout will charge real cards. Use sk_test_... while integrating.",
  );
} else if (!stripeKey.startsWith("sk_test_")) {
  check("warn", "Stripe", "STRIPE_SECRET_KEY should start with sk_test_ or sk_live_.");
} else {
  check("ok", "Stripe", `Billing mode: ${billingMode} using a test-mode key.`);
}

if (stripeKey && !has("STRIPE_WEBHOOK_SECRET")) {
  check(
    "missing",
    "Stripe",
    "STRIPE_WEBHOOK_SECRET is missing — checkout works but credits will not be granted by webhooks.",
  );
  check(
    "info",
    "Stripe",
    "Run: stripe listen --forward-to localhost:3000/api/stripe/webhook",
  );
} else if (has("STRIPE_WEBHOOK_SECRET") && !get("STRIPE_WEBHOOK_SECRET").startsWith("whsec_")) {
  check("warn", "Stripe", "STRIPE_WEBHOOK_SECRET should start with whsec_.");
} else if (has("STRIPE_WEBHOOK_SECRET")) {
  check("ok", "Stripe", "Webhook secret configured.");
}

if (stripeKey) {
  let cliVersion = null;
  try {
    cliVersion = execFileSync("stripe", ["--version"], {
      encoding: "utf8",
      timeout: 5000,
      shell: process.platform === "win32",
    }).trim();
  } catch {
    cliVersion = null;
  }
  if (cliVersion) check("ok", "Stripe", `Stripe CLI available (${cliVersion}).`);
  else {
    check(
      "info",
      "Stripe",
      "Stripe CLI not found. Install it for webhook forwarding: https://stripe.com/docs/stripe-cli",
    );
  }
  if (!unlimitedDev) {
    check(
      "info",
      "Stripe",
      "Credits are real in Stripe mode. Set GOLPO_UNLIMITED_DEV=1 to keep unlimited credits while testing.",
    );
  }
}

// ---------------------------------------------------------------------------
// FFmpeg (bundled, no configuration required)
// ---------------------------------------------------------------------------
let renderOk = false;
try {
  const { default: ffmpegPath } = await import("ffmpeg-static");
  const { default: ffprobe } = await import("ffprobe-static");
  renderOk = Boolean(ffmpegPath && existsSync(ffmpegPath) && existsSync(ffprobe.path));
} catch {
  renderOk = false;
}
if (renderOk) check("ok", "Render", "Bundled FFmpeg + FFprobe available (MP4 + JPEG posters).");
else {
  check(
    "missing",
    "Render",
    "FFmpeg binaries are missing — run `npm install` to restore ffmpeg-static.",
  );
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const symbols = { ok: "[ok]  ", warn: "[warn]", missing: "[--]  ", info: "[info]" };
const order = ["ok", "warn", "missing", "info"];

console.log("");
console.log("Golpo integration preflight");
console.log(`Environment: ${existsSync(envPath) ? envPath : "(no .env.local found)"}`);
console.log("");

for (const level of order) {
  for (const item of checks.filter((entry) => entry.level === level)) {
    console.log(`${symbols[level]} ${item.area.padEnd(9)} ${item.message}`);
  }
}

const missing = checks.filter((entry) => entry.level === "missing");
console.log("");
console.log(
  `Resolved modes → auth: mysql:${dbName}, billing: ${billingMode}, scripts: ${scriptMode}, transcription: ${transcriptionMode}, narration: ${ttsMode}, render: ${renderOk ? "ffmpeg" : "storyboard"}`,
);
console.log(
  missing.length === 0
    ? "All integrations are configured. Restart `npm run dev` to pick up changes."
    : `${missing.length} item(s) still need credentials — the app runs with local fallbacks meanwhile.`,
);
console.log("");

if (STRICT && missing.length > 0) process.exitCode = 1;
