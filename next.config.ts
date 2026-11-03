import type { NextConfig } from "next";

/**
 * `npm run app` (daily use) builds into its own folder, so building or running the dev server
 * never touches the app you are recording with — and vice versa.
 */
const isApp = process.env.npm_lifecycle_event?.startsWith("app");

const nextConfig: NextConfig = {
  distDir: isApp ? ".next-app" : ".next",
  // libSQL loads a native SQLite binary for local "file:" databases; keep it out of the bundle.
  serverExternalPackages: ["@libsql/client", "libsql"],
};

export default nextConfig;
