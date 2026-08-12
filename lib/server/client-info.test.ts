import { afterEach, describe, expect, it, vi } from "vitest";

import { clientFamily, normalise } from "./client-info";

vi.mock("../repositories/api-tokens", () => ({
  recordClientUse: vi.fn().mockResolvedValue(undefined),
  lastClientUse: vi.fn().mockResolvedValue(null),
}));

afterEach(() => vi.clearAllMocks());

describe("normalise", () => {
  it("returns null for missing name", () => {
    expect(normalise({})).toBeNull();
    expect(normalise({ name: "", version: "1" })).toBeNull();
  });
  it("returns null for non-string name", () => {
    expect(normalise({ name: 42 })).toBeNull();
  });
  it("captures name and version", () => {
    expect(normalise({ name: "claude-code", version: "1.2.3" })).toEqual({
      name: "claude-code",
      version: "1.2.3",
      capturedAt: expect.any(Number),
    });
  });
  it("defaults a missing version to 'unknown'", () => {
    const out = normalise({ name: "opencode" });
    expect(out?.version).toBe("unknown");
  });
});

describe("clientFamily", () => {
  it.each([
    ["claude-code", "claude-code"],
    ["Claude Code", "claude-code"],
    ["codex-cli", "codex"],
    ["codex_experimental", "codex"],
    ["Cursor", "cursor"],
    ["vscode", "vscode"],
    ["GitHub Copilot Chat", "vscode"],
    ["opencode", "opencode"],
    ["random-thing", "unknown"],
  ] as const)("%s -> %s", (input, expected) => {
    expect(clientFamily(input)).toBe(expected);
  });
});

/**
 * Integration with the repository is exercised end-to-end by
 * `scripts/mcp-smoke.ts` against a live server, not in this unit. The unit
 * tests here cover the pure helpers so a regression in the DB path fails in
 * CI before the slower smoke runs.
 */
