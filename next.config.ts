import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  serverExternalPackages: ["better-sqlite3", "minio"],
  turbopack: {
    root: __dirname,
  },
  // Next 16 allows a single dev server per dist dir (lock in <distDir>/dev).
  // The test suites point this at .next-test/.next-e2e so they can boot their
  // own mock-mode server while the regular `npm run dev` keeps running.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
