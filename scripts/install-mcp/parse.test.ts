import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseArgs } from "./parse";

describe("parseArgs", () => {
  let savedToken: string | undefined;

  beforeEach(() => {
    savedToken = process.env.TODOX_TOKEN;
    delete process.env.TODOX_TOKEN;
  });

  afterEach(() => {
    if (savedToken === undefined) {
      delete process.env.TODOX_TOKEN;
    } else {
      process.env.TODOX_TOKEN = savedToken;
    }
  });

  it("throws on unknown client", () => {
    expect(() => parseArgs(["wat"])).toThrow(/client must be one of/);
  });

  it("leaves --opencode-layout undefined so the installer detects one", () => {
    // Undefined is not the same as a default here: it means "read the existing
    // config", which is right almost every time. A default would overrule it.
    expect(parseArgs(["opencode"]).openCodeLayout).toBeUndefined();
  });

  it("accepts both OpenCode layouts", () => {
    expect(parseArgs(["opencode", "--opencode-layout", "v1"]).openCodeLayout).toBe("v1");
    expect(parseArgs(["opencode", "--opencode-layout", "v2"]).openCodeLayout).toBe("v2");
  });

  it("rejects an unrecognised layout rather than silently detecting", () => {
    // Falling back to detection would leave the user believing their flag had
    // been honoured, which is the failure mode this whole area is about.
    expect(() => parseArgs(["opencode", "--opencode-layout", "v3"])).toThrow(
      /--opencode-layout must be 'v1' or 'v2'/,
    );
  });

  it("rejects a bare --opencode-layout", () => {
    expect(() => parseArgs(["opencode", "--opencode-layout"])).toThrow(
      /--opencode-layout must be 'v1' or 'v2'/,
    );
  });

  it("accepts a known client and defaults", () => {
    expect(parseArgs(["claude-code"])).toEqual({
      client: "claude-code",
      url: "https://www.todox.dev/api/mcp",
      token: "",
      transport: "http",
      dryRun: false,
      verbose: false,
      writeMemory: false,
    });
  });

  it("parses flags and short-forms", () => {
    expect(
      parseArgs([
        "codex",
        "--transport",
        "stdio",
        "--token",
        "tk",
        "--url",
        "https://x/mcp",
        "--dry-run",
        "--verbose",
      ]),
    ).toEqual({
      client: "codex",
      url: "https://x/mcp",
      token: "tk",
      transport: "stdio",
      dryRun: true,
      verbose: true,
      writeMemory: false,
    });
  });

  it("rejects an invalid transport", () => {
    expect(() => parseArgs(["cursor", "--transport", "ftp"])).toThrow(/--transport/);
  });

  it("treats --dry-run and --verbose as boolean flags without a value", () => {
    expect(parseArgs(["opencode", "--dry-run"]).dryRun).toBe(true);
    expect(parseArgs(["opencode", "--verbose"]).verbose).toBe(true);
  });

  it("leaves the memory file alone unless it is asked", () => {
    // The default matters more than the flag: this writes to the file someone
    // keeps their own standing instructions in, and doing that because they
    // asked to register a server is not what they asked for.
    expect(parseArgs(["claude-code"]).writeMemory).toBe(false);
    expect(parseArgs(["claude-code", "--write-memory"]).writeMemory).toBe(true);
  });

  it("does not swallow the client name after --write-memory", () => {
    // Same trap as --dry-run: without being declared boolean, the parser takes
    // the next argv as its value and the client name disappears.
    expect(parseArgs(["--write-memory", "codex"]).client).toBe("codex");
    expect(parseArgs(["--write-memory", "codex"]).writeMemory).toBe(true);
  });

  it("does not consume the next argv as a value for boolean flags", () => {
    // Regression: `pnpm install:mcp --dry-run claude-code` is the natural
    // invocation. The naive parser would set flags["dry-run"] = "claude-code"
    // and leave positional empty, throwing "client must be one of ...".
    expect(parseArgs(["--dry-run", "claude-code"])).toEqual({
      client: "claude-code",
      url: "https://www.todox.dev/api/mcp",
      token: "",
      transport: "http",
      dryRun: true,
      verbose: false,
      writeMemory: false,
    });
    expect(parseArgs(["--verbose", "codex"]).verbose).toBe(true);
    expect(parseArgs(["--verbose", "codex"]).client).toBe("codex");
  });

  it("reads TODOX_TOKEN from the environment when --token is absent", () => {
    process.env.TODOX_TOKEN = "from-env";
    expect(parseArgs(["vscode"]).token).toBe("from-env");
  });

  it("prefers --token over TODOX_TOKEN when both are set", () => {
    process.env.TODOX_TOKEN = "from-env";
    expect(parseArgs(["vscode", "--token", "from-flag"]).token).toBe("from-flag");
  });

  it("errors when --token is given without a value", () => {
    expect(() => parseArgs(["claude-code", "--token"])).toThrow(/--token/);
    expect(() => parseArgs(["claude-code", "--token", "--verbose"])).toThrow(/--token/);
  });
});
