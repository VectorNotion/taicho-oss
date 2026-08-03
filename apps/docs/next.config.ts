import path from "node:path";
import type { NextConfig } from "next";

const monorepoRoot = path.resolve(process.cwd(), "../..");

const nextConfig: NextConfig = {
  agentRules: false,
  outputFileTracingRoot: monorepoRoot,
  outputFileTracingIncludes: {
    "/*": ["../../docs/content/**/*"],
  },
  poweredByHeader: false,
  turbopack: { root: monorepoRoot },
};

export default nextConfig;
