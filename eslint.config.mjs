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
    "next-env.d.ts",
    // Other checkouts of this repo made by coding agents.
    ".claude/**",
    // pdf.js's image decoders, copied from pdfjs-dist (scripts/copy-pdfjs-wasm.ts).
    "public/pdfjs-wasm/**",
  ]),
]);

export default eslintConfig;
