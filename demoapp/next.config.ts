import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  basePath: "/webmcp-bridge/demoapp",
  output: "export",
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  trailingSlash: true,
  transpilePackages: ["@searchboxlabs/webmcp-bridge"],
  turbopack: {
    root: path.resolve(projectDirectory, ".."),
  },
};

export default nextConfig;
