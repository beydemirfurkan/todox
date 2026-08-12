import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, promises as fs, rmSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { client } from "./cursor";

const root = mkdtempSync(path.join(tmpdir(), "todox-cursor-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A home directory per test, so nothing depends on the order they run in. */
const homeFor = async (name: string) => {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  process.env.HOME = dir;
  // Windows reads USERPROFILE first when computing os.homedir(); without
  // this the redirect would leak to the developer's real ~/.cursor/mcp.json.
  process.env.USERPROFILE = dir;
  return dir;
};

const HTTP = {
  transport: "http" as const,
  url: "https://www.todox.dev/api/mcp",
  token: "todox_test",
};

const readConfig = async (home: string) =>
  JSON.parse(await fs.readFile(path.join(home, ".cursor", "mcp.json"), "utf8"));

let savedHome: string | undefined;
let savedUserProfile: string | undefined;

beforeEach(() => {
  savedHome = process.env.HOME;
  savedUserProfile = process.env.USERPROFILE;
});

afterEach(async () => {
  // `delete`, not `undefined`: setting an env var to the string "undefined"
  // would make `os.homedir()` return the literal path "/undefined".
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserProfile;
});

describe("cursor installer", () => {
  it("creates ~/.cursor/mcp.json with mcpServers.todox when nothing is there", async () => {
    const home = await homeFor("create");

    const result = await client.install(HTTP);

    expect(result.status).toBe("created");
    expect((await readConfig(home)).mcpServers.todox).toEqual({
      url: HTTP.url,
      headers: { Authorization: `Bearer ${HTTP.token}` },
    });
    await expect(client.verify()).resolves.toEqual({
      ok: true,
      detail: path.join(home, ".cursor", "mcp.json"),
    });
  });

  it("replaces an existing todox entry rather than duplicating it", async () => {
    const home = await homeFor("replace");
    await client.install({ transport: "http", url: "https://old/mcp", token: "old" });

    const second = await client.install({ transport: "http", url: "https://new/mcp", token: "new" });

    expect(second.status).toBe("updated");
    const { mcpServers } = await readConfig(home);
    expect(Object.keys(mcpServers)).toEqual(["todox"]);
    expect(mcpServers.todox.url).toBe("https://new/mcp");
    expect(mcpServers.todox.headers.Authorization).toBe("Bearer new");
  });

  it("leaves unrelated servers in the config untouched", async () => {
    const home = await homeFor("preserve");
    await fs.mkdir(path.join(home, ".cursor"), { recursive: true });
    await fs.writeFile(
      path.join(home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { other: { type: "stdio" } } }),
      "utf8",
    );

    await client.install(HTTP);

    const config = await readConfig(home);
    expect(Object.keys(config.mcpServers).sort()).toEqual(["other", "todox"]);
    expect(config.mcpServers.other).toEqual({ type: "stdio" });
    expect(config.mcpServers.todox.url).toBe(HTTP.url);
  });

  it("rejects the stdio transport with an actionable message", async () => {
    await homeFor("stdio");
    await expect(
      client.install({ transport: "stdio", url: "irrelevant", token: "t" }),
    ).rejects.toThrow(/http transport only/);
  });

  it("detect finds the client from the config file alone", async () => {
    const home = await homeFor("detect");
    expect(await client.detect()).toBe(false);
    await fs.mkdir(path.join(home, ".cursor"), { recursive: true });
    await fs.writeFile(path.join(home, ".cursor", "mcp.json"), "{}", "utf8");
    expect(await client.detect()).toBe(true);
  });
});
