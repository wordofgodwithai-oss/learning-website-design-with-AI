"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AuthMode } from "@/lib/integrations";

function GoogleIcon() {
  return (
    <svg className="gicon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.7 1.22 9.2 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg className="gicon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
      <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}

export interface SignInPanelProps {
  redirectTo?: string;
  authMode?: AuthMode;
  supabase?: { url: string; anonKey: string } | null;
  initialError?: string | null;
}

export function SignInPanel({
  redirectTo = "/playground",
  authMode = "local",
  supabase = null,
  initialError = null,
}: SignInPanelProps) {
  const router = useRouter();
  const [email, setEmail] = useState("demo@golpo.local");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"google" | "microsoft" | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const liveAuth = authMode === "supabase" && supabase !== null;

  async function localSignIn(provider: "google" | "microsoft") {
    setBusy(provider);
    setError(null);
    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, email, name, redirect: redirectTo }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Sign-in failed.");
        return;
      }
      // Mirrors the dashboard, which keeps the access token in localStorage.
      try {
        localStorage.setItem(
          "sb-local-auth-token",
          JSON.stringify({ access_token: data.access_token, user: data.user }),
        );
        sessionStorage.removeItem("redirectAfterLogin");
      } catch {
        // Storage can be unavailable in private modes; the cookie still works.
      }
      router.push(data.redirect || redirectTo);
      router.refresh();
    } catch {
      setError("Could not reach the local server. Is `npm run dev` running?");
    } finally {
      setBusy(null);
    }
  }

  async function oauthSignIn(provider: "google" | "microsoft") {
    if (!supabase) {
      setError("Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.");
      return;
    }
    setBusy(provider);
    setError(null);
    try {
      const client = createSupabaseBrowserClient(supabase.url, supabase.anonKey);
      const callback = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
        redirectTo,
      )}`;
      const { error: oauthError } = await client.auth.signInWithOAuth({
        provider: provider === "microsoft" ? "azure" : "google",
        options: {
          redirectTo: callback,
          queryParams:
            provider === "microsoft" ? { prompt: "select_account" } : undefined,
        },
      });
      if (oauthError) {
        setError(oauthError.message);
        setBusy(null);
      }
      // On success the browser navigates to the provider; no further work here.
    } catch {
      setError("Could not start the OAuth flow.");
      setBusy(null);
    }
  }

  function signIn(provider: "google" | "microsoft") {
    return liveAuth ? oauthSignIn(provider) : localSignIn(provider);
  }

  return (
    <div className="card login-card">
      <h2>Sign in to Golpo</h2>
      <p className="hint">
        {liveAuth
          ? "Continue with Google or Microsoft. Authentication is handled by Supabase."
          : "Use either provider. This is a local clone — no OAuth round-trip leaves your machine."}
      </p>

      {!liveAuth ? (
        <>
          <div className="field">
            <label className="label" htmlFor="signin-email">
              Email
            </label>
            <input
              id="signin-email"
              className="input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
            <span className="hint">
              The default account is pre-seeded with a welcome video and a dev API key. Any address
              creates a new local account.
            </span>
          </div>

          <div className="field">
            <label className="label" htmlFor="signin-name">
              Display name <span style={{ fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              id="signin-name"
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ada Lovelace"
              autoComplete="name"
            />
          </div>
        </>
      ) : null}

      <button
        type="button"
        className="btn btn-oauth"
        onClick={() => signIn("google")}
        disabled={busy !== null}
      >
        <GoogleIcon />
        {busy === "google" ? "Signing in…" : "Continue with Google"}
      </button>
      <div style={{ height: 10 }} />
      <button
        type="button"
        className="btn btn-oauth microsoft"
        onClick={() => signIn("microsoft")}
        disabled={busy !== null}
      >
        <MicrosoftIcon />
        {busy === "microsoft" ? "Signing in…" : "Continue with Microsoft"}
      </button>

      {error ? <div className="toast">{error}</div> : null}

      <div className="local-note">
        {liveAuth ? (
          <>
            Supabase auth is active. Accounts are mirrored into the local store so the BFF and API
            keep the same contract.
          </>
        ) : (
          <>
            Local mode: credits are infinite, every plan feature is unlocked, and Stripe is not
            called. See <span className="mono">src/lib/billing/mock-billing.ts</span>.
          </>
        )}
      </div>
    </div>
  );
}
