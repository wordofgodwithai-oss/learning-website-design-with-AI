import Link from "next/link";

import type { User } from "@/lib/types";
import { SignOutButton } from "@/components/SignOutButton";

const LINKS = [
  { href: "/playground", label: "Playground" },
  { href: "/library", label: "Library" },
  { href: "/pricing", label: "Pricing" },
  { href: "/api-docs", label: "API" },
  { href: "/mcp", label: "MCP" },
];

export function AppShell({
  user,
  credits,
  children,
}: {
  user: User;
  credits: number;
  children: React.ReactNode;
}) {
  const initials = (user.display_name || user.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <>
      <header className="nav">
        <div className="nav-inner">
          <Link href="/playground" className="brand">
            <span className="brand-mark">G</span>
            <span>
              Golpo <span style={{ color: "var(--muted)", fontWeight: 500 }}>Local</span>
            </span>
          </Link>
          <nav className="nav-links">
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="nav-spacer" />
          <span className="credits-pill" title="Infinite local credits — billing is mocked">
            <span className="status-dot" />
            {credits.toLocaleString()} credits
          </span>
          <div className="nav-user">
            <span className="avatar">{initials || "G"}</span>
            <span className="sr-only">{user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="page">
        <div className="container">{children}</div>
      </main>
      <footer className="footer">
        <div className="footer-inner">
          <span>
            Golpo Local · reconstruction for local learning. Billing and feature gating are
            mocked; generation is simulated.
          </span>
          <span className="mono">localhost:3000</span>
        </div>
      </footer>
    </>
  );
}
