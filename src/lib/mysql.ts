import "server-only";

import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";

/**
 * MySQL connection pool (WAMP / MySQL 8+).
 *
 * Configuration lives in `.env.local`:
 *
 *   GOLPO_DB_HOST=127.0.0.1
 *   GOLPO_DB_PORT=3306
 *   GOLPO_DB_USER=root
 *   GOLPO_DB_PASSWORD=
 *   GOLPO_DB_NAME=golpo
 *
 * `timezone: "Z"` keeps DATETIME(3) columns in UTC so they round-trip through
 * the app as the same ISO-8601 strings the API has always returned.
 *
 * The pool is cached on globalThis because Next.js re-evaluates modules on hot
 * reload; without that, every edit would leak a new pool until MySQL refused
 * connections.
 */

function text(value: string | undefined, fallback = ""): string {
  const trimmed = (value ?? "").trim();
  return trimmed || fallback;
}

export const DB_HOST = text(process.env.GOLPO_DB_HOST, "127.0.0.1");
export const DB_PORT = Number(text(process.env.GOLPO_DB_PORT, "3306")) || 3306;
export const DB_USER = text(process.env.GOLPO_DB_USER, "root");
export const DB_PASSWORD = process.env.GOLPO_DB_PASSWORD ?? "";
export const DB_NAME = text(process.env.GOLPO_DB_NAME, "golpo");

const globalForMysql = globalThis as unknown as { __golpoMysqlPool?: Pool };

export const pool: Pool = (globalForMysql.__golpoMysqlPool ??= mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: Number(process.env.GOLPO_DB_POOL_SIZE ?? 10),
  queueLimit: 0,
  timezone: "Z",
  dateStrings: false,
  multipleStatements: false,
  connectTimeout: 10_000,
}));

/** `SELECT` helper: rows only, typed by the caller. */
export async function rows<T extends RowDataPacket>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const [result] = await pool.query<T[]>(sql, params);
  return result;
}

/** `INSERT` / `UPDATE` / `DELETE` helper. */
export async function run(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [result] = await pool.query<ResultSetHeader>(sql, params);
  return result;
}

/**
 * Runs `fn` inside a transaction, committing on success and rolling back on any
 * thrown error. Every write in `src/lib/db.ts` goes through here.
 */
export async function transaction<T>(fn: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // The connection is unusable; close() below recycles it.
    }
    throw error;
  } finally {
    connection.release();
  }
}

/** Human-readable target for logs and /api/health. */
export const DB_LABEL = `${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
