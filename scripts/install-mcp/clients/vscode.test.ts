import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, promises as fs, rmSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { client } from "./vscode";

const root = mkdtempSync(path.join(tmpdir(), "todox-vscode-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/**
 * `process.platform` is a plain value property, so `vi.spyOn` cannot see it.
 * `Object.defineProperty` is the supported lever here; restoring the original
 * descriptor afterwards is not optional -- a leaked "win32" would follow this
 * suite into the next one and break paths tests on Linux.
 */
function withPlatform<T>(platform: NodeJS.Platform, body: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  return body().finally(() => {
    if (original) Object.defineProperty(process, "platform", original);
  });
}

const HTTP = {
  transport: "http" as const,
  url: "https://www.todox.dev/api/mcp",
  token: "todox_test",
};

let savedHome: string | undefined;
let savedUserProfile: string | undefined;
let savedAppData: string | undefined;

beforeEach(() => {
  savedHome = process.env.HOME;
  savedUserProfile = process.env.USERPROFILE;
  savedAppData = process.env.APPDATA;
});

afterEach(async () => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserProfile;
  if (savedAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = savedAppData;
});

describe("vscode installer", () => {
  it("writes %APPDATA%/Code/User/mcp.json under the root key `servers` on win32", async () => {
    await withPlatform("win32", async () => {
      const home = path.join(root, "win32");
      await fs.mkdir(home, { recursive: true });
      const appdata = path.join(home, "AppData", "Roaming");
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      process.env.APPDATA = appdata;
      await fs.mkdir(path.join(appdata, "Code", "User"), { recursive: true });

      const result = await client.install(HTTP);

      expect(result.status).toBe("created");
      expect(result.path).toBe(path.join(appdata, "Code", "User", "mcp.json"));
      // The file we wrote must be the file on this disk -- not a string path
      // that happens to share the suffix with a different install.
      const cfg = JSON.parse(
        await fs.readFile(path.join(appdata, "Code", "User", "mcp.json"), "utf8"),
      );
      expect(cfg.servers.todox).toEqual({
        type: "http",
        url: HTTP.url,
        headers: { Authorization: `Bearer ${HTTP.token}` },
      });
      await expect(client.verify()).resolves.toEqual({
        ok: true,
        detail: path.join(appdata, "Code", "User", "mcp.json"),
      });
    });
  });

  it("writes ~/Library/Application Support/Code/User/mcp.json on darwin", async () => {
    await withPlatform("darwin", async () => {
      const home = path.join(root, "darwin");
      await fs.mkdir(home, { recursive: true });
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      const expected = path.join(
        home,
        "Library",
        "Application Support",
        "Code",
        "User",
        "mcp.json",
      );

      const result = await client.install(HTTP);

      expect(result.path).toBe(expected);
      const cfg = JSON.parse(await fs.readFile(expected, "utf8"));
      expect(cfg.servers.todox.url).toBe(HTTP.url);
      // And nothing at the Linux path, which is where this used to land. The
      // assertion that matters is this one: writing to ~/.config on a Mac
      // succeeds and reads back clean, so only the absence proves the fix.
      await expect(
        fs.access(path.join(home, ".config", "Code", "User", "mcp.json")),
      ).rejects.toThrow();
    });
  });

  it("reports an entry left behind at the Linux path on darwin", async () => {
    await withPlatform("darwin", async () => {
      const home = path.join(root, "darwin-stale");
      const stale = path.join(home, ".config", "Code", "User");
      await fs.mkdir(stale, { recursive: true });
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      // What a Mac that ran the broken version is left holding.
      await fs.writeFile(
        path.join(stale, "mcp.json"),
        JSON.stringify({ servers: { todox: { url: "https://old" } } }),
        "utf8",
      );

      await expect(client.staleInstalls()).resolves.toEqual([
        `servers.todox in ${path.join(stale, "mcp.json")}`,
      ]);
    });
  });

  it("writes ~/.config/Code/User/mcp.json on linux", async () => {
    await withPlatform("linux", async () => {
      const home = path.join(root, "linux");
      await fs.mkdir(home, { recursive: true });
      process.env.HOME = home;
      process.env.USERPROFILE = home;

      const result = await client.install(HTTP);

      expect(result.status).toBe("created");
      expect(result.path).toBe(path.join(home, ".config", "Code", "User", "mcp.json"));
      const cfg = JSON.parse(
        await fs.readFile(path.join(home, ".config", "Code", "User", "mcp.json"), "utf8"),
      );
      expect(cfg.servers.todox.url).toBe(HTTP.url);
    });
  });

  it("leaves unrelated entries in `servers` untouched", async () => {
    await withPlatform("linux", async () => {
      const home = path.join(root, "preserve");
      await fs.mkdir(path.join(home, ".config", "Code", "User"), { recursive: true });
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      await fs.writeFile(
        path.join(home, ".config", "Code", "User", "mcp.json"),
        JSON.stringify({ servers: { other: { type: "stdio" } } }),
        "utf8",
      );

      await client.install(HTTP);

      const cfg = JSON.parse(
        await fs.readFile(path.join(home, ".config", "Code", "User", "mcp.json"), "utf8"),
      );
      expect(Object.keys(cfg.servers).sort()).toEqual(["other", "todox"]);
      expect(cfg.servers.other).toEqual({ type: "stdio" });
    });
  });

  it("detect flips once the config file is present", async () => {
    await withPlatform("linux", async () => {
      const home = path.join(root, "detect");
      await fs.mkdir(home, { recursive: true });
      process.env.HOME = home;
      process.env.USERPROFILE = home;

      expect(await client.detect()).toBe(false);
      await fs.mkdir(path.join(home, ".config", "Code", "User"), { recursive: true });
      await fs.writeFile(path.join(home, ".config", "Code", "User", "mcp.json"), "{}", "utf8");
      expect(await client.detect()).toBe(true);
    });
  });
});
