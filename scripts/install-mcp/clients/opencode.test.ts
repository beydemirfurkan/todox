import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, promises as fs, rmSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { client, detectLayout } from "./opencode";

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

const configFileIn = (home: string) =>
  path.join(home, ".config", "opencode", "opencode.json");

const readConfig = async (home: string) =>
  JSON.parse(await fs.readFile(configFileIn(home), "utf8"));

/** Seed a config so the installer has a layout to read rather than assume. */
const seedConfig = async (home: string, doc: unknown) => {
  await fs.mkdir(path.join(home, ".config", "opencode"), { recursive: true });
  await fs.writeFile(configFileIn(home), JSON.stringify(doc), "utf8");
};

const STDIO = {
  transport: "stdio" as const,
  url: "http://localhost:3000/api/mcp",
  token: "tk",
};

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

/**
 * OpenCode moved its server map one level down between majors, and writing the
 * wrong one is silent — the server just never appears. Every case below is
 * about which of the two the installer picks and whether it says so.
 */
describe("opencode layout detection", () => {
  it("reads v2 from a config that already nests under mcp.servers", async () => {
    const home = await homeFor("detect-v2");
    await seedConfig(home, { mcp: { servers: { other: { type: "remote" } } } });

    await expect(detectLayout()).resolves.toEqual({ major: "v2", certain: true });
  });

  it("reads v1 from a config with servers keyed directly under mcp", async () => {
    const home = await homeFor("detect-v1");
    await seedConfig(home, { mcp: { other: { type: "remote", url: "https://x" } } });

    await expect(detectLayout()).resolves.toEqual({ major: "v1", certain: true });
  });

  it("assumes v2 but admits it when there is no config to read", async () => {
    await homeFor("detect-none");

    await expect(detectLayout()).resolves.toEqual({ major: "v2", certain: false });
  });

  it("assumes rather than throws when the config is unparseable", async () => {
    const home = await homeFor("detect-broken");
    await fs.mkdir(path.join(home, ".config", "opencode"), { recursive: true });
    await fs.writeFile(configFileIn(home), "{ not json", "utf8");

    await expect(detectLayout()).resolves.toEqual({ major: "v2", certain: false });
  });

  it("treats an empty mcp object as no signal", async () => {
    const home = await homeFor("detect-empty");
    await seedConfig(home, { mcp: {} });

    await expect(detectLayout()).resolves.toEqual({ major: "v2", certain: false });
  });
});

describe("opencode installer", () => {
  it("writes the v2 layout on a fresh config and flags it as an assumption", async () => {
    const home = await homeFor("fresh");

    const result = await client.install(STDIO);

    expect(result.status).toBe("created");
    expect(result.note).toMatch(/assumed OpenCode v2 layout/);
    // The note has to carry the way out, not just the guess.
    expect(result.note).toMatch(/--opencode-layout v1/);
    const cfg = await readConfig(home);
    expect(cfg.mcp.servers.todox.type).toBe("local");
  });

  it("follows an existing v1 config instead of assuming", async () => {
    const home = await homeFor("keeps-v1");
    await seedConfig(home, { mcp: { other: { type: "remote", url: "https://x" } } });

    const result = await client.install({ ...STDIO, transport: "http" });

    expect(result.note).toBe("OpenCode v1 layout");
    const cfg = await readConfig(home);
    expect(cfg.mcp.todox.type).toBe("remote");
    expect(cfg.mcp.servers).toBeUndefined();
    await expect(client.verify()).resolves.toEqual({ ok: true, detail: configFileIn(home) });
  });

  it("honours an explicit --opencode-layout over what it would have detected", async () => {
    const home = await homeFor("override");
    await seedConfig(home, { mcp: { servers: {} } });

    const result = await client.install({ ...STDIO, transport: "http", openCodeLayout: "v1" });

    expect(result.note).toBe("OpenCode v1 layout");
    expect((await readConfig(home)).mcp.todox.type).toBe("remote");
  });

  it("reports a todox entry left at the layout this OpenCode does not read", async () => {
    const home = await homeFor("stale");
    // A v1 install, on a machine that has since moved to a v2 config.
    await seedConfig(home, {
      mcp: { todox: { type: "remote", url: "https://old" }, servers: {} },
    });

    await expect(client.staleInstalls()).resolves.toEqual([
      `mcp.todox in ${configFileIn(home)}`,
    ]);
  });

  it("says nothing about stale entries once only the live layout has one", async () => {
    const home = await homeFor("stale-clean");
    await seedConfig(home, { mcp: { servers: {} } });

    await client.install({ ...STDIO, transport: "http" });

    await expect(client.staleInstalls()).resolves.toEqual([]);
  });

  it("honours http transport (type=remote) when requested", async () => {
    const home = await homeFor("http");
    await client.install({ transport: "http", url: "https://override/mcp", token: "tk" });

    const cfg = await readConfig(home);
    expect(cfg.mcp.servers.todox.type).toBe("remote");
    // Exact match, not "contains": the installer used to hardcode the production
    // URL and ignore --url, which made --url http://localhost:3000/api/mcp
    // still hit production.
    expect(cfg.mcp.servers.todox.url).toBe("https://override/mcp");
    expect(cfg.mcp.servers.todox.headers.Authorization).toBe("Bearer tk");
  });

  it("points the stdio child at this repo, not at the caller's cwd", async () => {
    const home = await homeFor("stdio-path");
    await client.install(STDIO);

    const { args } = (await readConfig(home)).mcp.servers.todox;
    // Resolved from the installer's own location, so running the script from a
    // subdirectory cannot write a path to nothing.
    expect(args[0]).toBe("-y");
    expect(args[1]).toBe("tsx");
    expect(path.isAbsolute(args[2])).toBe(true);
    expect(args[2].endsWith(path.join("mcp", "server.ts"))).toBe(true);
    await expect(fs.access(args[2])).resolves.toBeUndefined();
  });

  it("passes --url through to the stdio child as TODOX_URL (origin only)", async () => {
    const home = await homeFor("stdio-url");
    await client.install(STDIO);

    const cfg = await readConfig(home);
    // The stdio server calls its parent origin; passing it through `/api/mcp`
    // would make the child re-derive it from a non-base path. Origin is the
    // shape the rest of the app expects.
    expect(cfg.mcp.servers.todox.env.TODOX_URL).toBe("http://localhost:3000");
    expect(cfg.mcp.servers.todox.env.TODOX_TOKEN).toBe("${TODOX_TOKEN}");
  });

  it("records the client name and version in the stdio env (Task 7 reads these)", async () => {
    const home = await homeFor("stdio-client");
    await client.install(STDIO);

    const cfg = await readConfig(home);
    expect(cfg.mcp.servers.todox.env.TODOX_CLIENT_NAME).toBe("opencode");
    expect(cfg.mcp.servers.todox.env.TODOX_CLIENT_VERSION).toBe("0.0.0");
  });

  it("leaves unrelated entries untouched", async () => {
    const home = await homeFor("preserve");
    await seedConfig(home, {
      theme: "dark",
      mcp: { servers: { other: { type: "remote", url: "https://x/mcp" } } },
    });

    await client.install({ transport: "http", url: "https://y/mcp", token: "tk" });

    const cfg = await readConfig(home);
    expect(cfg.theme).toBe("dark");
    expect(Object.keys(cfg.mcp.servers).sort()).toEqual(["other", "todox"]);
    expect(cfg.mcp.servers.other).toEqual({ type: "remote", url: "https://x/mcp" });
  });

  it("detect finds the client from the config file alone", async () => {
    const home = await homeFor("detect");
    expect(await client.detect()).toBe(false);
    await seedConfig(home, {});
    expect(await client.detect()).toBe(true);
  });
});
