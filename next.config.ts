import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  serverExternalPackages: ["better-sqlite3", "minio"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
