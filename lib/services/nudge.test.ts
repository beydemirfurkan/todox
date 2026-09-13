import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMORY_SNIPPET } from "../mcp-clients";

/**
 * The one sentence for an account that connects and never calls.
 *
 * Two of four connected accounts in production did exactly that for weeks,
 * and the advice that would have fixed it sat behind the call they were not
 * making. What these tests hold: it is said only when measured true, it names
 * the client's own file, it carries the snippet so the agent can write it
 * without looking anything up, and it stops the moment a tool is called.
 */
const usage = vi.hoisted(() => ({ callsBy: vi.fn() }));
vi.mock("../repositories/tool-usage", () => ({ callsBy: usage.callsBy }));

const { silentAccountNudge, SILENT_AFTER_DAYS, SILENCE_WINDOW_DAYS } = await import("./nudge");

const NOW = Date.UTC(2026, 8, 13, 12);
const DAY = 86_400_000;
const minted = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
const clock = () => NOW;

beforeEach(() => {
  vi.clearAllMocks();
  usage.callsBy.mockResolvedValue(0);
});

describe("when it speaks", () => {
  it("says nothing while the token is still being set up", async () => {
    const out = await silentAccountNudge(
      { userId: 7, tokenCreatedAt: minted(SILENT_AFTER_DAYS - 1), client: "opencode" },
      clock,
    );
    expect(out).toBeNull();
    // Not even measured: the client notes cover the first days.
    expect(usage.callsBy).not.toHaveBeenCalled();
  });

  it("says nothing to an account that has called a tool inside the window", async () => {
    usage.callsBy.mockResolvedValue(3);
    const out = await silentAccountNudge(
      { userId: 7, tokenCreatedAt: minted(30), client: "opencode" },
      clock,
    );
    expect(out).toBeNull();
  });

  it("measures the window from today, by day", async () => {
    await silentAccountNudge({ userId: 7, tokenCreatedAt: minted(30), client: null }, clock);
    const since = new Date(NOW - SILENCE_WINDOW_DAYS * DAY).toISOString().slice(0, 10);
    expect(usage.callsBy).toHaveBeenCalledWith(7, since);
  });

  it("speaks to an account that is old enough and has called nothing", async () => {
    const out = await silentAccountNudge(
      { userId: 7, tokenCreatedAt: minted(9), client: "opencode" },
      clock,
    );
    expect(out).toMatch(/CONNECTED FOR 9 DAYS AND HAS NOT CALLED A TOOL/);
  });

  it("says nothing for a token whose date cannot be read", async () => {
    expect(
      await silentAccountNudge({ userId: 7, tokenCreatedAt: "nope", client: "opencode" }, clock),
    ).toBeNull();
  });
});

describe("what it says", () => {
  const speak = (client: string | null) =>
    silentAccountNudge({ userId: 7, tokenCreatedAt: minted(9), client }, clock);

  it("names the client's own user-level file", async () => {
    expect(await speak("opencode")).toContain("~/.config/opencode/AGENTS.md");
    expect(await speak("claude-code")).toContain("~/.claude/CLAUDE.md");
    // A directory-shaped client gets todox's own file inside it.
    expect(await speak("cursor")).toContain("~/.cursor/rules/todox.md");
  });

  it("carries the snippet itself, so nothing has to be looked up", async () => {
    expect(await speak("opencode")).toContain(MEMORY_SNIPPET);
  });

  it("asks for get_context first and for the developer to be told", async () => {
    const out = (await speak("claude-code"))!;
    expect(out).toMatch(/1\. Call get_context/);
    expect(out).toMatch(/tell the developer/);
  });

  it("still knows what kind of file to look for when the client is unknown", async () => {
    const out = (await speak("some-editor"))!;
    expect(out).toMatch(/user-level instructions for every project/);
    expect(out).toContain(MEMORY_SNIPPET);
  });
});
