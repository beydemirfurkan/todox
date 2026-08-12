import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, promises as fs, rmSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

/**
 * Hoisted so both module mocks below can read it: `vi.mock` factories run
 * before any top-level `const` in this file has been initialised.
 */
const state = vi.hoisted(() => ({
  home: "",
  /** Exit code per spawned command; null stands for "failed to spawn". */
  exitCodes: new Map<string, number | null>(),
  calls: [] as { command: string; args: string[] }[],
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, homedir: () => state.home }, homedir: () => state.home };
});

vi.mock("node:child_process", () => ({
  spawn: (command: string, args: string[]) => {
    state.calls.push({ command, args });
    const code = state.exitCodes.get(command) ?? 1;
    return {
      on(event: string, callback: (code: number | null) => void) {
        if (code === null && event === "error") callback(null);
        if (code !== null && event === "exit") callback(code);
        return this;
      },
    };
  },
}));

const { client } = await import("./claude-code");

const root = mkdtempSync(path.join(tmpdir(), "todox-claude-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A home directory per test, so nothing here depends on execution order. */
const homeFor = async (name: string) => {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  state.home = dir;
  return dir;
};

const readConfig = async (home: string) =>
  JSON.parse(await fs.readFile(path.join(home, ".claude.json"), "utf8"));

/** `process.platform` is a plain value property, so `vi.spyOn` cannot see it. */
async function withPlatform(platform: NodeJS.Platform, body: () => Promise<void>) {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    await body();
  } finally {
    if (original) Object.defineProperty(process, "platform", original);
  }
}

const HTTP = { transport: "http", url: "https://www.todox.dev/api/mcp", token: "todox_test" } as const;

beforeEach(() => {
  state.calls = [];
  // Default: `claude` is not on PATH, which forces the JSON fallback.
  state.exitCodes = new Map([
    ["which", 1],
    ["where", 1],
  ]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("claude-code installer, JSON fallback", () => {
  it("creates ~/.claude.json with mcpServers.todox when nothing is there", async () => {
    const home = await homeFor("json-create");

    const result = await client.install(HTTP);

    expect(result).toEqual({
      path: path.join(home, ".claude.json"),
      status: "created",
      entryId: "json",
    });
    expect((await readConfig(home)).mcpServers.todox).toEqual({
      type: "http",
      url: HTTP.url,
      headers: { Authorization: "Bearer todox_test" },
    });
    await expect(client.verify()).resolves.toEqual({ ok: true, detail: result.path });
  });

  it("replaces an existing todox entry rather than duplicating it", async () => {
    const home = await homeFor("json-replace");
    await client.install({ transport: "http", url: "https://old/mcp", token: "old" });

    const second = await client.install({ transport: "http", url: "https://new/mcp", token: "new" });

    expect(second.status).toBe("updated");
    const { mcpServers } = await readConfig(home);
    expect(Object.keys(mcpServers)).toEqual(["todox"]);
    expect(mcpServers.todox.url).toBe("https://new/mcp");
    expect(mcpServers.todox.headers.Authorization).toBe("Bearer new");
  });

  it("leaves unrelated servers in the config untouched", async () => {
    const home = await homeFor("json-preserve");
    await fs.writeFile(
      path.join(home, ".claude.json"),
      JSON.stringify({ numStartups: 7, mcpServers: { other: { type: "stdio" } } }),
      "utf8",
    );

    await client.install(HTTP);

    const config = await readConfig(home);
    expect(config.numStartups).toBe(7);
    expect(config.mcpServers.other).toEqual({ type: "stdio" });
    expect(config.mcpServers.todox.url).toBe(HTTP.url);
  });
});

describe("claude-code installer, native CLI", () => {
  beforeEach(() => {
    state.exitCodes = new Map([
      ["which", 0],
      ["where", 0],
      ["claude", 0],
    ]);
  });

  it("passes the header key and value as two separate arguments", async () => {
    await homeFor("native-args");

    const result = await client.install(HTTP);

    expect(result.entryId).toBe("native");
    const add = state.calls.find((call) => call.command === "claude");
    // The greedy-parser bug fires when these are joined into one positional.
    expect(add?.args).toEqual([
      "mcp",
      "add",
      "todox",
      "--transport",
      "http",
      HTTP.url,
      "--header",
      "Authorization",
      "Bearer todox_test",
    ]);
  });

  it("does not also write the JSON config when the native CLI succeeds", async () => {
    const home = await homeFor("native-no-json");

    await client.install(HTTP);

    // The real CLI would have written the file; our mock cannot, so an empty
    // directory is exactly the proof that we did not write it ourselves.
    expect(await fs.readdir(home)).toEqual([]);
  });

  it("falls back to JSON when the native CLI exits non-zero", async () => {
    const home = await homeFor("native-fails");
    state.exitCodes.set("claude", 1);

    const result = await client.install(HTTP);

    expect(result.entryId).toBe("json");
    expect((await readConfig(home)).mcpServers.todox.url).toBe(HTTP.url);
  });

  it("falls back to JSON when the native CLI cannot be spawned", async () => {
    const home = await homeFor("native-missing");
    state.exitCodes.set("claude", null);

    const result = await client.install(HTTP);

    expect(result.entryId).toBe("json");
    expect((await readConfig(home)).mcpServers.todox.url).toBe(HTTP.url);
  });
});

describe("claude-code installer, platform and contract", () => {
  it("probes with `where` on Windows and `which` elsewhere", async () => {
    await homeFor("probe");

    await withPlatform("win32", async () => {
      await client.install(HTTP);
    });
    expect(state.calls[0].command).toBe("where");

    state.calls = [];
    await withPlatform("linux", async () => {
      await client.install(HTTP);
    });
    expect(state.calls[0].command).toBe("which");
  });

  it("rejects the stdio transport with an actionable message", async () => {
    await homeFor("stdio");
    await expect(
      client.install({ transport: "stdio", url: "irrelevant", token: "t" }),
    ).rejects.toThrow(/--transport http/);
  });

  it("verify re-reads from disk and rejects a non-Bearer header", async () => {
    const home = await homeFor("verify-bad-header");
    await client.install(HTTP);
    const config = await readConfig(home);
    config.mcpServers.todox.headers.Authorization = "todox_test";
    await fs.writeFile(path.join(home, ".claude.json"), JSON.stringify(config), "utf8");

    await expect(client.verify()).resolves.toEqual({
      ok: false,
      detail: `Authorization header missing or not Bearer in ${path.join(home, ".claude.json")}`,
    });
  });

  it("verify reports a missing entry rather than throwing", async () => {
    const home = await homeFor("verify-absent");
    const result = await client.verify();
    expect(result.ok).toBe(false);
    expect(result.detail).toBe(`no mcpServers.todox in ${path.join(home, ".claude.json")}`);
  });

  it("detect finds the client from the config file alone", async () => {
    const home = await homeFor("detect");
    expect(await client.detect()).toBe(false);
    await fs.writeFile(path.join(home, ".claude.json"), "{}", "utf8");
    expect(await client.detect()).toBe(true);
  });
});
