import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, promises as fs, rmSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { client } from "./opencode";

const root = mkdtempSync(path.join(tmpdir(), "todox-opencode-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A home directory per test, so nothing depends on the order they run in. */
const homeFor = async (name: string) => {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  return dir;
};

const readConfig = async (home: string) =>
  JSON.parse(await fs.readFile(path.join(home, ".config", "opencode", "opencode.json"), "utf8"));

let savedHome: string | undefined;
let savedUserProfile: string | undefined;

beforeEach(() => {
  savedHome = process.env.HOME;
  savedUserProfile = process.env.USERPROFILE;
});

afterEach(async () => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserProfile;
});

describe("opencode installer", () => {
  it("writes stdio config (type=local) under root key `mcp` by default", async () => {
    const home = await homeFor("stdio");

    const result = await client.install({ transport: "stdio", url: "irrelevant", token: "tk" });

    expect(result.status).toBe("created");
    const cfg = await readConfig(home);
    expect(cfg.mcp.todox).toMatchObject({
      type: "local",
      command: "npx",
      args: ["-y", "tsx", path.resolve(process.cwd(), "mcp/server.ts")],
    });
    expect(cfg.mcp.todox.env.TODOX_TOKEN).toBe("${TODOX_TOKEN}");
    await expect(client.verify()).resolves.toEqual({
      ok: true,
      detail: path.join(home, ".config", "opencode", "opencode.json"),
    });
  });

  it("honours http transport (type=remote) when requested", async () => {
    const home = await homeFor("http");
    await client.install({ transport: "http", url: "https://override/mcp", token: "tk" });

    const cfg = await readConfig(home);
    expect(cfg.mcp.todox.type).toBe("remote");
    expect(cfg.mcp.todox.url).toContain("/api/mcp");
    expect(cfg.mcp.todox.headers.Authorization).toBe("Bearer tk");
  });

  it("records the client name and version in the stdio env (Task 7 reads these)", async () => {
    const home = await homeFor("stdio-client");
    await client.install({ transport: "stdio", url: "irrelevant", token: "tk" });

    const cfg = await readConfig(home);
    expect(cfg.mcp.todox.env.TODOX_CLIENT_NAME).toBe("opencode");
    expect(cfg.mcp.todox.env.TODOX_CLIENT_VERSION).toBe("0.0.0");
  });

  it("leaves unrelated entries under `mcp` untouched", async () => {
    const home = await homeFor("preserve");
    await fs.mkdir(path.join(home, ".config", "opencode"), { recursive: true });
    await fs.writeFile(
      path.join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ mcp: { other: { type: "remote", url: "https://x/mcp" } } }),
      "utf8",
    );

    await client.install({ transport: "http", url: "https://y/mcp", token: "tk" });

    const cfg = await readConfig(home);
    expect(Object.keys(cfg.mcp).sort()).toEqual(["other", "todox"]);
    expect(cfg.mcp.other).toEqual({ type: "remote", url: "https://x/mcp" });
  });

  it("detect finds the client from the config file alone", async () => {
    const home = await homeFor("detect");
    expect(await client.detect()).toBe(false);
    await fs.mkdir(path.join(home, ".config", "opencode"), { recursive: true });
    await fs.writeFile(
      path.join(home, ".config", "opencode", "opencode.json"),
      "{}",
      "utf8",
    );
    expect(await client.detect()).toBe(true);
  });
});
