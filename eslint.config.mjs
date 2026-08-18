import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `const { password_hash: _omit, ...rest } = user` is the clearest way to
      // strip a secret; the discarded binding is the point, not an oversight.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Not ours: `pnpm test:coverage` writes a bundled HTML report here, and
    // linting somebody else's minified viewer says nothing about this code.
    "coverage/**",
    // Build output, not source: `pnpm pack:mcp` emits CommonJS here, and the
    // rule against `require` is a rule about what we write, not about what the
    // compiler produces from it.
    "dist-npm/**",
  ]),
]);

export default eslintConfig;
