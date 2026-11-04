import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Native/heavy server-only modules must not be bundled by webpack: sharp
  // loads platform binaries, ffmpeg-static/ffprobe-static ship executables.
  serverExternalPackages: ["sharp", "ffmpeg-static", "ffprobe-static", "stripe"],
  // The local data store and uploads live in .data/; nothing here needs to be
  // bundled into the client.
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
