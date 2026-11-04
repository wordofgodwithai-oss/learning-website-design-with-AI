import Link from "next/link";

import { ADDONS, ANNUAL_DISCOUNTS, PAYG_TIERS, PRICING_PLANS } from "@/lib/billing/constants";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const user = await getSessionUser();

  return (
    <>
      <header className="nav">
        <div className="nav-inner">
          <Link href={user ? "/playground" : "/"} className="brand">
            <span className="brand-mark">G</span>
            <span>
              Golpo <span style={{ color: "var(--muted)", fontWeight: 500 }}>Local</span>
            </span>
          </Link>
          <nav className="nav-links">
            <Link href="/api-docs">API</Link>
            <Link href="/mcp">MCP</Link>
          </nav>
          <div className="nav-spacer" />
          <Link href={user ? "/playground" : "/"} className="btn btn-sm">
            {user ? "Playground" : "Home"}
          </Link>
        </div>
      </header>

      <main className="page">
        <div className="container">
          <div className="page-head">
            <div>
              <h1 style={{ fontSize: 32 }}>Plans</h1>
              <p>
                Copied from the public pricing page in REPORT.md section 8, kept here so the
                catalogue is visible. Nothing on this page can charge you.
              </p>
            </div>
            <span className="badge badge-warn">Mock billing</span>
          </div>

          <div className="local-note" style={{ marginBottom: 24 }}>
            <strong>Local mode:</strong> every account has 999,999 credits, all add-ons are
            enabled, and checkout buttons only redirect back to the playground. The real Stripe
            flows are listed as TODOs in <span className="mono">src/lib/billing/mock-billing.ts</span>.
          </div>

          <div className="grid grid-3">
            {PRICING_PLANS.map((plan) => (
              <div className="card" key={plan.id} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ margin: 0, fontSize: 18 }}>{plan.name}</h3>
                  {plan.id === "free" ? <span className="badge">Current</span> : null}
                </div>
                <div style={{ fontSize: 30, fontWeight: 700, margin: "12px 0 2px" }}>
                  {plan.priceMonthly === null ? "Custom" : `$${plan.priceMonthly}`}
                  {plan.priceMonthly !== null ? (
                    <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500 }}>/mo</span>
                  ) : null}
                </div>
                <div className="hint" style={{ marginBottom: 12 }}>
                  {plan.creditsPerMonth === null
                    ? "Custom credits"
                    : `${plan.creditsPerMonth} credits / month`}
                  {ANNUAL_DISCOUNTS[plan.id]
                    ? ` · save ${Math.round(ANNUAL_DISCOUNTS[plan.id] * 100)}% annually`
                    : ""}
                </div>
                <p style={{ fontSize: 13.5 }}>{plan.blurb}</p>
                <ul className="hero-points" style={{ marginTop: 0, marginBottom: 18 }}>
                  {plan.features.map((feature) => (
                    <li key={feature} style={{ fontSize: 13 }}>
                      {feature}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="btn btn-block"
                  style={{ marginTop: "auto" }}
                  disabled
                  title="Billing is mocked in local mode"
                >
                  Included locally
                </button>
              </div>
            ))}
          </div>

          <div className="grid grid-2" style={{ marginTop: 22 }}>
            <div className="card">
              <div className="card-title">
                <h3>Pay as you go</h3>
                <span className="badge badge-warn">Not charged</span>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Credits</th>
                    <th>Price per credit</th>
                  </tr>
                </thead>
                <tbody>
                  {PAYG_TIERS.map((tier) => (
                    <tr key={tier.min}>
                      <td>
                        {tier.min}
                        {Number.isFinite(tier.max) ? `–${tier.max}` : "+"}
                      </td>
                      <td>${tier.pricePerCredit.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <div className="card-title">
                <h3>Add-ons</h3>
                <span className="badge badge-ok">Unlocked</span>
              </div>
              <div className="list">
                {Object.entries(ADDONS).map(([key, addon]) => (
                  <div className="list-row" key={key}>
                    <span>{addon.label}</span>
                    <span className="badge">
                      {addon.price === null ? "variable" : `$${addon.price}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span>Prices are static reference data, not a live Stripe catalogue.</span>
          <span className="mono">REPORT.md §8</span>
        </div>
      </footer>
    </>
  );
}
