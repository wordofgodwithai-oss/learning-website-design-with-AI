"use client";

import { useState } from "react";

export function PlanCheckoutButton({
  plan,
  annual = false,
  label,
  disabled = false,
}: {
  plan: string;
  annual?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/plan-upgrade/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan, annual }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.error ?? "Could not start checkout.");
        return;
      }
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setError("Stripe did not return a checkout URL.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-block"
        style={{ marginTop: "auto" }}
        onClick={checkout}
        disabled={disabled || busy}
      >
        {busy ? "Opening checkout…" : label ?? `Choose ${plan}`}
      </button>
      {error ? <div className="toast" style={{ marginTop: 10 }}>{error}</div> : null}
    </>
  );
}
