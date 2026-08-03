import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
  globalIgnores([
    ".next/**",
    ".turbo/**",
    "out/**",
    "build/**",
    "extension-react/build/**",
    "extension-react/utils/**",
    "extension-react/webpack.config.js",
    "graph/.venv/**",
    "packages/platform/jobs/workers/**",
    "next-env.d.ts",
  ]),
]);
