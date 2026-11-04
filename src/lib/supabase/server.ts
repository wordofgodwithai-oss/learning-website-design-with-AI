import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/integrations";

/**
 * Supabase server client (cookie based, @supabase/ssr).
 *
 * Only constructed when GOLPO_AUTH_MODE resolves to `supabase`; the local HMAC
 * auth remains the default and needs no Supabase project.
 */
export function supabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export async function createSupabaseServerClient() {
  if (!supabaseConfigured()) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required for supabase auth mode.");
  }
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a server component: Next.js forbids cookie writes.
          // The callback route and middleware handle the writes instead.
        }
      },
    },
  });
}
