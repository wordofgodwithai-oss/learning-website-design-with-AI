#!/usr/bin/env node
/**
 * Creates the MySQL database and applies `db/schema.sql`.
 *
 *   npm run db:setup
 *
 * Connection settings come from `.env.local` (or the real environment):
 *
 *   GOLPO_DB_HOST=127.0.0.1
 *   GOLPO_DB_PORT=3306
 *   GOLPO_DB_USER=root
 *   GOLPO_DB_PASSWORD=
 *   GOLPO_DB_NAME=golpo
 *
 * Existing rows are never deleted. The first time the app boots against an
 * empty database it imports `.data/db.json` automatically.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const root = process.cwd();

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

const env = { ...readEnvFile(path.join(root, ".env.local")), ...process.env };
const host = (env.GOLPO_DB_HOST || "127.0.0.1").trim();
const port = Number(env.GOLPO_DB_PORT || 3306);
const user = (env.GOLPO_DB_USER || "root").trim();
const password = env.GOLPO_DB_PASSWORD ?? "";
const name = (env.GOLPO_DB_NAME || "golpo").trim();

if (!/^[A-Za-z0-9_]+$/.test(name)) {
  console.error(`Invalid GOLPO_DB_NAME "${name}". Use letters, digits and underscores only.`);
  process.exit(1);
}

const schemaPath = path.join(root, "db", "schema.sql");
if (!existsSync(schemaPath)) {
  console.error(`Missing ${schemaPath}.`);
  process.exit(1);
}

const label = `${user}@${host}:${port}`;
console.log(`Connecting to MySQL at ${label}…`);

let connection;
try {
  connection = await mysql.createConnection({
    host,
    port,
    user,
    password,
    multipleStatements: true,
    charset: "utf8mb4",
  });
} catch (error) {
  console.error(`Could not connect: ${error.message}`);
  console.error("Is WAMP running (tray icon green) and MySQL listening on this port?");
  process.exit(1);
}

try {
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await connection.query(`USE \`${name}\``);
  await connection.query(readFileSync(schemaPath, "utf8"));

  const [tables] = await connection.query("SHOW TABLES");
  const [counts] = await connection.query(
    "SELECT (SELECT COUNT(*) FROM `users`) AS users, (SELECT COUNT(*) FROM `videos`) AS videos, (SELECT COUNT(*) FROM `jobs`) AS jobs",
  );

  console.log(`Database \`${name}\` is ready — ${tables.length} tables.`);
  console.log(
    `Rows: ${counts[0].users} users, ${counts[0].videos} videos, ${counts[0].jobs} jobs.`,
  );
  if (counts[0].users === 0) {
    console.log("The database is empty; `npm run dev` will import .data/db.json on first boot.");
  }
} catch (error) {
  console.error(`Setup failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await connection.end();
}
