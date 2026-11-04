import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextResponse } from "next/server";

export function json(data: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(data, { status, headers });
}

/** Error envelope used by every BFF and API route. */
export function fail(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, success: false, ...extra }, { status });
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

export function str(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

export function bool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "on", "yes"].includes(normalized)) return true;
    if (["false", "0", "off", "no", ""].includes(normalized)) return false;
  }
  if (typeof value === "number") return value !== 0;
  return fallback;
}

export function num(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(str(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function pagination(url: URL): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, Math.trunc(num(url.searchParams.get("page"), 1)));
  const pageSize = clamp(Math.trunc(num(url.searchParams.get("page_size"), 20)), 1, 100);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

// ---------------------------------------------------------------------------
// Outbound fetch guard (used by /api/extract-script-source and upload-proxy).
// Blocks localhost / RFC1918 / link-local targets so a local dev tool cannot be
// used to probe the host network.
// ---------------------------------------------------------------------------

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.")
    );
  }
  return true;
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  accept?: string;
}

/**
 * Fetch an http(s) URL with a byte cap, a timeout and a private-address block.
 * The production app proxies remote media through /api/upload-proxy; this is a
 * local, defensive reimplementation.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<{ bytes: Buffer; contentType: string; finalUrl: string }> {
  const { maxBytes = 10 * 1024 * 1024, timeoutMs = 10_000 } = options;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  if (url.hostname === "localhost") throw new Error("Blocked host");

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("Host did not resolve");
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Blocked host");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: options.accept ? { accept: options.accept } : undefined,
    });
    if (!response.ok) throw new Error(`Upstream responded ${response.status}`);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBytes) throw new Error("Response too large");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error("Response too large");
    return {
      bytes: buffer,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      finalUrl: response.url || url.toString(),
    };
  } finally {
    clearTimeout(timer);
  }
}
