import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Golpo Local — AI explainer video studio",
  description:
    "A local reconstruction of the Golpo AI dashboard: prompt-to-video generation, library, public API v1/v2 and an MCP endpoint.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
