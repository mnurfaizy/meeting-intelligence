import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // libSQL loads a native SQLite binary for local "file:" databases; keep it out of the bundle.
  serverExternalPackages: ["@libsql/client", "libsql"],
};

export default nextConfig;
