import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, promises as fs, rmSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

import {
  detectJsonHttp,
  findStaleEntries,
  installJsonHttp,
  verifyJsonHttp,
} from "./json-http";

const root = mkdtempSync(path.join(tmpdir(), "todox-json-http-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A directory per test, so nothing here depends on the order they run in. */
const caseDir = async (name: string) => {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

const TARGET = (file: string) => ({
  file,
  rootKeys: ["mcpServers"] as const,
  name: "todox",
});

/** OpenCode v2's shape: the entry map is two levels down. */
const NESTED = (file: string) => ({
  file,
  rootKeys: ["mcp", "servers"] as const,
  name: "todox",
});

describe("installJsonHttp", () => {
  it("creates a fresh entry under the root key", async () => {
    const dir = await caseDir("create");
    const file = path.join(dir, "mcp.json");

    const result = await installJsonHttp(TARGET(file), { url: "https://x/mcp", kind: "http" });

    expect(result).toEqual({ path: file, status: "created" });
    const cfg = JSON.parse(await fs.readFile(file, "utf8"));
    expect(cfg.mcpServers.todox).toEqual({ url: "https://x/mcp", kind: "http" });
  });

  it("returns 'updated' when the entry already existed", async () => {
    const dir = await caseDir("update");
    const file = path.join(dir, "mcp.json");
    await installJsonHttp(TARGET(file), { url: "https://a/mcp" });

    const result = await installJsonHttp(TARGET(file), { url: "https://b/mcp" });

    expect(result.status).toBe("updated");
    const cfg = JSON.parse(await fs.readFile(file, "utf8"));
    expect(cfg.mcpServers.todox.url).toBe("https://b/mcp");
  });

  it("leaves sibling entries untouched", async () => {
    const dir = await caseDir("preserve");
    const file = path.join(dir, "mcp.json");
    await fs.writeFile(
      file,
      JSON.stringify({ mcpServers: { other: { type: "stdio" } } }),
      "utf8",
    );

    await installJsonHttp(TARGET(file), { url: "https://x/mcp" });

    const cfg = JSON.parse(await fs.readFile(file, "utf8"));
    expect(Object.keys(cfg.mcpServers).sort()).toEqual(["other", "todox"]);
    expect(cfg.mcpServers.other).toEqual({ type: "stdio" });
  });

  it("creates the config file when none is present", async () => {
    const dir = await caseDir("absent");
    const file = path.join(dir, "deep", "down", "mcp.json");

    const result = await installJsonHttp(TARGET(file), { url: "https://x/mcp" });

    expect(result.status).toBe("created");
    const cfg = JSON.parse(await fs.readFile(file, "utf8"));
    expect(cfg.mcpServers.todox.url).toBe("https://x/mcp");
  });

  it("creates the intermediate objects for a nested key path", async () => {
    const dir = await caseDir("nested-create");
    const file = path.join(dir, "opencode.json");

    await installJsonHttp(NESTED(file), { type: "remote", url: "https://x/mcp" });

    const cfg = JSON.parse(await fs.readFile(file, "utf8"));
    expect(cfg.mcp.servers.todox).toEqual({ type: "remote", url: "https://x/mcp" });
  });

  it("keeps siblings at every level of a nested key path", async () => {
    const dir = await caseDir("nested-preserve");
    const file = path.join(dir, "opencode.json");
    await fs.writeFile(
      file,
      JSON.stringify({
        theme: "dark",
        mcp: { servers: { other: { type: "remote" } } },
      }),
      "utf8",
    );

    await installJsonHttp(NESTED(file), { type: "remote", url: "https://x/mcp" });

    const cfg = JSON.parse(await fs.readFile(file, "utf8"));
    expect(cfg.theme).toBe("dark");
    expect(Object.keys(cfg.mcp.servers).sort()).toEqual(["other", "todox"]);
    expect(cfg.mcp.servers.other).toEqual({ type: "remote" });
  });

  it("refuses to overwrite a key that holds something other than an object", async () => {
    const dir = await caseDir("nested-collision");
    const file = path.join(dir, "opencode.json");
    // A user who set `mcp` to a string has a broken config, but it is theirs.
    // Replacing it silently is the failure this module exists to stop making.
    await fs.writeFile(file, JSON.stringify({ mcp: "off" }), "utf8");

    await expect(installJsonHttp(NESTED(file), { url: "https://x/mcp" })).rejects.toThrow(
      /'mcp' is already set to a non-object/,
    );
    // And the file it refused to write is exactly as it was.
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ mcp: "off" });
  });
});

describe("verifyJsonHttp", () => {
  it("reports ok when the entry exists", async () => {
    const dir = await caseDir("verify-ok");
    const file = path.join(dir, "mcp.json");
    await installJsonHttp(TARGET(file), { url: "https://x/mcp" });

    await expect(verifyJsonHttp(TARGET(file))).resolves.toEqual({ ok: true, detail: file });
  });

  it("reports a missing entry by name rather than throwing", async () => {
    const dir = await caseDir("verify-absent");
    const file = path.join(dir, "mcp.json");

    await expect(verifyJsonHttp(TARGET(file))).resolves.toEqual({
      ok: false,
      detail: `no mcpServers.todox in ${file}`,
    });
  });

  it("rejects a non-Bearer header after an on-disk mutation", async () => {
    const dir = await caseDir("verify-bad-header");
    const file = path.join(dir, "mcp.json");
    await installJsonHttp(TARGET(file), {
      url: "https://x/mcp",
      headers: { Authorization: "Bearer original" },
    });
    // Hand-edit the file to drop the Bearer prefix; verify must re-read from disk.
    const cfg = JSON.parse(await fs.readFile(file, "utf8"));
    cfg.mcpServers.todox.headers.Authorization = "todox_test";
    await fs.writeFile(file, JSON.stringify(cfg), "utf8");

    await expect(verifyJsonHttp(TARGET(file), "Bearer ")).resolves.toEqual({
      ok: false,
      detail: `Authorization header missing or not Bearer in ${file}`,
    });
  });

  it("accepts a matching Bearer prefix", async () => {
    const dir = await caseDir("verify-good-header");
    const file = path.join(dir, "mcp.json");
    await installJsonHttp(TARGET(file), {
      url: "https://x/mcp",
      headers: { Authorization: "Bearer abc" },
    });

    await expect(verifyJsonHttp(TARGET(file), "Bearer ")).resolves.toEqual({
      ok: true,
      detail: file,
    });
  });
});

describe("verifyJsonHttp on a nested key path", () => {
  it("does not accept a v1 entry as a v2 one", async () => {
    const dir = await caseDir("verify-nested-mismatch");
    const file = path.join(dir, "opencode.json");
    // Written where OpenCode v1 reads; asked for where v2 reads. This is the
    // pair that used to pass, because verify re-read whatever install wrote.
    await installJsonHttp({ file, rootKeys: ["mcp"], name: "todox" }, { url: "https://x" });

    await expect(verifyJsonHttp(NESTED(file))).resolves.toEqual({
      ok: false,
      detail: `no mcp.servers.todox in ${file}`,
    });
  });

  it("accepts the entry once it is at the nested path", async () => {
    const dir = await caseDir("verify-nested-ok");
    const file = path.join(dir, "opencode.json");
    await installJsonHttp(NESTED(file), { url: "https://x" });

    await expect(verifyJsonHttp(NESTED(file))).resolves.toEqual({ ok: true, detail: file });
  });
});

describe("findStaleEntries", () => {
  it("finds an entry sitting at a layout the client does not read", async () => {
    const dir = await caseDir("stale-found");
    const file = path.join(dir, "opencode.json");
    await installJsonHttp({ file, rootKeys: ["mcp"], name: "todox" }, { url: "https://old" });

    await expect(
      findStaleEntries([{ file, rootKeys: ["mcp"] }], "todox"),
    ).resolves.toEqual([`mcp.todox in ${file}`]);
  });

  it("says nothing when the stale layout is empty", async () => {
    const dir = await caseDir("stale-clean");
    const file = path.join(dir, "opencode.json");
    await installJsonHttp(NESTED(file), { url: "https://new" });

    await expect(findStaleEntries([{ file, rootKeys: ["mcp"] }], "todox")).resolves.toEqual(
      [],
    );
  });

  it("says nothing when the stale file does not exist", async () => {
    const dir = await caseDir("stale-absent");
    await expect(
      findStaleEntries([{ file: path.join(dir, "nope.json"), rootKeys: ["servers"] }], "todox"),
    ).resolves.toEqual([]);
  });

  it("survives an unparseable file at the stale location", async () => {
    const dir = await caseDir("stale-broken");
    const file = path.join(dir, "broken.json");
    // A guess about the past must not fail an install that is otherwise fine.
    await fs.writeFile(file, "{ not json", "utf8");

    await expect(findStaleEntries([{ file, rootKeys: ["servers"] }], "todox")).resolves.toEqual(
      [],
    );
  });
});

describe("detectJsonHttp", () => {
  it("returns false when the file is absent", async () => {
    const dir = await caseDir("detect-absent");
    expect(await detectJsonHttp(path.join(dir, "absent.json"))).toBe(false);
  });

  it("flips to true once the file is created", async () => {
    const dir = await caseDir("detect-present");
    const file = path.join(dir, "mcp.json");
    expect(await detectJsonHttp(file)).toBe(false);
    await fs.writeFile(file, "{}", "utf8");
    expect(await detectJsonHttp(file)).toBe(true);
  });
});
