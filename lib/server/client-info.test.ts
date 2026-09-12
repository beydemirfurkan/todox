import { afterEach, describe, expect, it, vi } from "vitest";

import { clientFamily, normalise } from "../client-identity";
import { clientDuringSetup, SETUP_WINDOW_DAYS } from "./client-info";

vi.mock("../repositories/api-tokens", () => ({
  recordClientUse: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => vi.clearAllMocks());

/**
 * The client is surfaced so the briefing can say where the memory file goes,
 * and that is setup advice: worth saying once, and read for a month by two
 * accounts in production before anybody measured it. The window is the
 * token's age because the server cannot see the file. Pure, because the row
 * it reads from was already fetched to authenticate the call.
 */
describe("clientDuringSetup", () => {
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 8, 12);
  const minted = (daysAgo: number) => ({
    createdAt: new Date(now - daysAgo * DAY).toISOString(),
    client: { name: "claude-code", version: "2.0", seenAt: new Date(now).toISOString() },
  });

  it("answers while the token is new", () => {
    expect(clientDuringSetup(minted(1), () => now)).toMatchObject({ name: "claude-code" });
  });

  it("answers on the last day of the window and not the day after", () => {
    expect(clientDuringSetup(minted(SETUP_WINDOW_DAYS), () => now)).not.toBeNull();
    expect(clientDuringSetup(minted(SETUP_WINDOW_DAYS + 1), () => now)).toBeNull();
  });

  it("says nothing when no client was ever recorded", () => {
    expect(clientDuringSetup({ ...minted(0), client: null }, () => now)).toBeNull();
  });

  it("says nothing for a row whose dates cannot be read", () => {
    expect(clientDuringSetup({ ...minted(0), createdAt: "not a date" }, () => now)).toBeNull();
    const badSeen = { ...minted(0), client: { ...minted(0).client, seenAt: "nope" } };
    expect(clientDuringSetup(badSeen, () => now)).toBeNull();
  });
});

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
