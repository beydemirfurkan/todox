import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Teach vitest the `@/` alias that `tsconfig.json` gives the rest of the
 * codebase.
 *
 * Without it, `pnpm test` could only reach files that import by relative path,
 * which in practice meant nothing under `app/` was testable at all — every
 * component there imports `@/lib/...`, so a test that pulled one in failed to
 * resolve before it ran a single assertion. That is why the snippets the
 * Account page hands people had no test while the installer had plenty.
 *
 * Beyond that and coverage, nothing is configured on purpose: vitest's
 * defaults already find `*.test.ts(x)` everywhere and skip `node_modules`, and
 * a partial copy of those globs here would be one more thing to keep in step.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    coverage: {
      /**
       * `.gitignore` and `.dockerignore` have both excluded `/coverage` since
       * the repo was started, and nothing has ever written it. Reporting is
       * opt-in (`pnpm test:coverage`) rather than part of `pnpm test`, which
       * runs on every push and is fast because it measures nothing.
       *
       * No threshold. A number here becomes the target, and the number this
       * suite would report is misleading in both directions: a third of it
       * covers the MCP install CLI, which is a convenience rather than the
       * product, while the repositories it does not reach are where a missed
       * ownership check lives. Read the report, do not chase it.
       */
      include: ["app/**", "lib/**", "mcp/**", "scripts/**"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/*.d.ts"],
      reporter: ["text-summary", "html"],
    },
  },
});
