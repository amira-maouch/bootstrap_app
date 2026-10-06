import tsParser from "@typescript-eslint/parser";
import { security } from "@heron-ws/eslint-config";

/**
 * Minimal lint: the shared Heron security rules (XSS / code-injection sinks).
 * Rules live in @heron-ws/eslint-config; this only wires them to the TS widget
 * sources. The safe path is html/setHTML/sanitize from @heron-ws/utils.
 */
export default [
  { ignores: ["dist/**", "dist-app/**", "bundles/**", "node_modules/**", "**/*.d.ts"] },
  {
    files: ["widgets/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  ...security,
];
