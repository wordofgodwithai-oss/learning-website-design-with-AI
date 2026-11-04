import { randomBytes, randomUUID } from "node:crypto";

/** UUID-v4 primary keys, matching the Supabase default. */
export function uuid(): string {
  return randomUUID();
}

/** Short, prefixed, URL-safe identifiers used for jobs and videos. */
export function shortId(prefix: string, bytes = 12): string {
  return `${prefix}_${randomBytes(bytes).toString("hex")}`;
}

/** `job_<hex>` / `vid_<hex>` as used in the report's polling examples. */
export function jobId(): string {
  return shortId("job");
}

export function videoId(): string {
  return shortId("vid");
}
