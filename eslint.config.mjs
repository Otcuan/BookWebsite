import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    // Vendored, minified PDF.js runtime and font data. This code is pinned
    // through package-lock.json and must not be linted as application source.
    "public/pdfjs/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
