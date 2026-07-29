import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/page.tsx"],
    rules: {
      // This client surface intentionally synchronizes browser/wallet state in
      // effects and creates timestamps inside user-triggered async handlers.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".vinext/**",
    "dist/**",
    "out/**",
    "build/**",
    "work/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
