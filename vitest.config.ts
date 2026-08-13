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
 * Nothing else is configured on purpose: vitest's defaults already find
 * `*.test.ts(x)` everywhere and skip `node_modules`, and a partial copy of
 * those globs here would be one more thing to keep in step.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
