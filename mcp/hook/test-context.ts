import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";


import type { HookConfig } from "./config";
import type { Logger } from "./log";
import type { HookContext, HookGit, HookInput } from "./types";

/** A directory that is not a checkout: every read answers "I do not know". */
const NO_GIT: HookGit = {
  root: () => undefined,
  head: () => undefined,
  branch: () => undefined,
  dirty: () => undefined,
  since: () => undefined,
  remote: () => undefined,
};

/** A hook context over a fresh data directory, for the handler tests. */
export function hookContext(
  overrides: {
    rpc?: HookContext["rpc"];
    input?: HookInput;
    config?: Partial<HookConfig>;
    now?: Date;
    git?: Partial<HookGit>;
  } = {},
) {
  const rpc = overrides.rpc ?? null;
  const now = overrides.now ?? new Date("2026-11-22T10:00:00Z");
  return {
    client: "claude-code",
    config: {
      token: rpc ? "todox_t" : undefined,
      url: "http://todox.test",
      dataDir: mkdtempSync(join(tmpdir(), "todox-hook-")),
      disabled: false,
      stopMode: "default",
      observe: true,
      ...overrides.config,
    },
    log: vi.fn<Logger>(),
    input: overrides.input ?? { session_id: "s1", cwd: "/repo" },
    rpc,
    now: () => now,
    git: { ...NO_GIT, ...overrides.git },
  } satisfies HookContext;
}
