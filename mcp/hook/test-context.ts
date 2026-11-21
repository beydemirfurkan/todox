import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

import type { HookConfig } from "./config";
import type { Logger } from "./log";
import type { HookContext, HookInput } from "./types";

/** A hook context over a fresh data directory, for the handler tests. */
export function hookContext(
  overrides: { rpc?: HookContext["rpc"]; input?: HookInput; config?: Partial<HookConfig>; now?: Date } = {},
) {
  const rpc = overrides.rpc ?? null;
  const now = overrides.now ?? new Date("2026-11-22T10:00:00Z");
  return {
    config: {
      token: rpc ? "todox_t" : undefined,
      url: "http://todox.test",
      dataDir: mkdtempSync(join(tmpdir(), "todox-hook-")),
      disabled: false,
      stopMode: "default",
      ...overrides.config,
    },
    log: vi.fn<Logger>(),
    input: overrides.input ?? { session_id: "s1", cwd: "/repo" },
    rpc,
    now: () => now,
  } satisfies HookContext;
}
