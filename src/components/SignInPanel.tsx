"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface SignInPanelProps {
  redirectTo?: string;
  initialError?: string | null;
}

type Mode = "sign-in" | "sign-up";

/**
 * Email + password sign-in for the MySQL backend, with a one-click demo
 * account. The demo path posts `{ provider: "dev" }`, so no credentials are
 * stored anywhere for it.
 */
export function SignInPanel({ redirectTo = "/playground", initialError = null }: SignInPanelProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"credentials" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);

  function afterSuccess(data: { redirect?: string; access_token?: string; user?: unknown }) {
    // Mirrors the real dashboard, which keeps its access token in localStorage.
    // The httpOnly cookie is what actually authenticates the session.
    try {
      localStorage.setItem(
        "golpo-auth-token",
        JSON.stringify({ access_token: data.access_token, user: data.user }),
      );
      sessionStorage.removeItem("redirectAfterLogin");
    } catch {
      // Storage can be unavailable in private modes; the cookie still works.
    }
    router.push(data.redirect || redirectTo);
    router.refresh();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Passwords are at least 8 characters.");
      return;
    }

    setBusy("credentials");
    try {
      const response = await fetch(
        mode === "sign-up" ? "/api/auth/sign-up" : "/api/auth/sign-in",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: address,
            password,
            name: name.trim() || undefined,
            redirect: redirectTo,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? (mode === "sign-up" ? "Could not create the account." : "Sign-in failed."));
        return;
      }
      afterSuccess(data);
    } catch {
      setError("Could not reach the server. Is `npm run dev` running?");
    } finally {
      setBusy(null);
    }
  }

  async function demoSignIn() {
    setBusy("demo");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "dev", redirect: redirectTo }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Demo sign-in failed.");
        return;
      }
      afterSuccess(data);
    } catch {
      setError("Could not reach the server. Is `npm run dev` running?");
    } finally {
      setBusy(null);
    }
  }

  function switchMode() {
    setMode((current) => (current === "sign-in" ? "sign-up" : "sign-in"));
    setError(null);
    setNotice(null);
    setPassword("");
  }

  const signingUp = mode === "sign-up";

  return (
    <div className="card login-card">
      <h2>{signingUp ? "Create your Golpo account" : "Sign in to Golpo"}</h2>
      <p className="hint">
        {signingUp
          ? "Accounts are stored in the local MySQL database. Your password is hashed with scrypt."
          : "Sign in with the email and password you registered on this machine."}
      </p>

      <form onSubmit={(event) => void submit(event)}>
        {signingUp ? (
          <div className="field">
            <label className="label" htmlFor="signup-name">
              Display name <span style={{ fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              id="signup-name"
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ada Lovelace"
              autoComplete="name"
            />
          </div>
        ) : null}

        <div className="field">
          <label className="label" htmlFor="auth-email">
            Email
          </label>
          <input
            id="auth-email"
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="auth-password">
            Password
          </label>
          <input
            id="auth-password"
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={signingUp ? "At least 8 characters" : "Your password"}
            autoComplete={signingUp ? "new-password" : "current-password"}
            required
            minLength={8}
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={busy !== null || !email.trim() || password.length < 8}
        >
          {busy === "credentials"
            ? signingUp
              ? "Creating account…"
              : "Signing in…"
            : signingUp
              ? "Create account"
              : "Sign in"}
        </button>
      </form>

      <div className="auth-switch">
        {signingUp ? "Already have an account?" : "New to Golpo Local?"}{" "}
        <button type="button" className="text-btn" onClick={switchMode}>
          {signingUp ? "Sign in" : "Create one"}
        </button>
      </div>

      <div className="divider">or</div>

      <button
        type="button"
        className="btn btn-block"
        onClick={() => void demoSignIn()}
        disabled={busy !== null}
      >
        {busy === "demo" ? "Opening the demo…" : "Continue with the demo account"}
      </button>

      {notice ? (
        <div className="local-note" style={{ marginTop: 10 }}>
          {notice}
        </div>
      ) : null}
      {error ? <div className="toast">{error}</div> : null}

      <div className="local-note">
        Demo mode: credits are infinite, every plan feature is unlocked, and Stripe is not called.
        See <span className="mono">src/lib/billing/mock-billing.ts</span>.
      </div>
    </div>
  );
}
