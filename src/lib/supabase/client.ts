"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client for the OAuth redirect flow.
 *
 * Config is passed in from the server component so the app keeps working when
 * no NEXT_PUBLIC_* variables were present at build time.
 */
export function createSupabaseBrowserClient(url: string, anonKey: string) {
  return createBrowserClient(url, anonKey);
}
