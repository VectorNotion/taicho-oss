import path from "node:path";
import type { NextConfig } from "next";
import { nextSecurityHeaderRules } from "../../packages/config/next-security";

const monorepoRoot = path.resolve(process.cwd(), "../..");
const nextConfig: NextConfig = {
  poweredByHeader: false,
  headers: async () => [...nextSecurityHeaderRules],
  redirects: async () => [
    {
      source: "/outreach/personas",
      destination: "/personas",
      permanent: true,
    },
  ],
  serverExternalPackages: ["falkordb"],
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
};

export default nextConfig;
