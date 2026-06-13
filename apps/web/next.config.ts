import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Monorepo: pin the workspace root so Next doesn't guess from lockfiles.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
