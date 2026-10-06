import tseslint from "typescript-eslint";
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
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // Register the TS plugin so pre-existing `// eslint-disable
    // @typescript-eslint/*` comments in widget code resolve to a known rule
    // instead of erroring. We enable none of its rules here.
    plugins: { "@typescript-eslint": tseslint.plugin },
  },
  // This lint runs only the security rules, so directives for other rules are
  // "unused" — don't report them (that is their own repo's lint's job).
  { linterOptions: { reportUnusedDisableDirectives: "off" } },
  ...security,
];
