import "server-only";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/integrations";
import type { User } from "@/lib/types";

/**
 * Verifies a Supabase access token against the project's `/auth/v1/user`
 * endpoint and maps it onto the local user record.
 *
 * Results are cached for a minute per token so a polling dashboard does not hit
 * Supabase on every request. Signature verification itself is delegated to
 * Supabase (it supports both the legacy shared secret and the newer asymmetric
 * signing keys, so no key material has to be shipped here).
 */

interface SupabaseUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}

export interface SupabaseIdentity {
  externalId: string;
  email: string;
  name: string;
  provider: User["provider"];
  avatarUrl: string | null;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; identity: SupabaseIdentity | null }>();

function providerFor(appProvider: unknown): User["provider"] {
  const value = typeof appProvider === "string" ? appProvider.toLowerCase() : "";
  if (value === "google") return "google";
  if (value === "azure" || value === "microsoft") return "microsoft";
  return "dev";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function identityFromSupabase(user: SupabaseUser): SupabaseIdentity | null {
  const email = (user.email ?? "").trim().toLowerCase();
  if (!user.id || !email) return null;
  const metadata = user.user_metadata ?? {};
  const name =
    asString(metadata.full_name) ||
    asString(metadata.name) ||
    asString(metadata.display_name) ||
    email.split("@")[0];
  const avatar =
    asString(metadata.avatar_url) || asString(metadata.picture) || null;

  return {
    externalId: user.id,
    email,
    name,
    provider: providerFor(user.app_metadata?.provider),
    avatarUrl: avatar,
  };
}

export async function verifySupabaseAccessToken(
  accessToken: string,
): Promise<SupabaseIdentity | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  const cached = cache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) return cached.identity;

  let identity: SupabaseIdentity | null = null;
  try {
    const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      identity = identityFromSupabase((await response.json()) as SupabaseUser);
    }
  } catch {
    identity = null;
  }

  // Do not cache transport failures for a full minute.
  cache.set(accessToken, {
    expiresAt: Date.now() + (identity ? CACHE_TTL_MS : 5_000),
    identity,
  });
  if (cache.size > 500) {
    const now = Date.now();
    for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key);
  }
  return identity;
}

export async function userFromSupabaseToken(accessToken: string): Promise<User | null> {
  const identity = await verifySupabaseAccessToken(accessToken);
  if (!identity) return null;
  const { upsertUser } = await import("@/lib/repo");
  return upsertUser({
    email: identity.email,
    name: identity.name,
    provider: identity.provider,
    avatarUrl: identity.avatarUrl,
    externalId: identity.externalId,
  });
}
