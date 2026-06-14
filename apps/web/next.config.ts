import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone build → a self-contained server bundle we can drop into a slim
  // container image (only the files the server actually needs).
  output: "standalone",
  // Monorepo: pin the workspace root so Next doesn't guess from lockfiles, and
  // so standalone tracing includes workspace deps.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
};

export default nextConfig;
