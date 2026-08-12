import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, promises as fs, rmSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { detectJsonHttp, installJsonHttp, verifyJsonHttp } from "./json-http";

const root = mkdtempSync(path.join(tmpdir(), "todox-json-http-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A directory per test, so nothing here depends on the order they run in. */
const caseDir = async (name: string) => {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

const TARGET = (file: string) => ({
  configPath: file,
  rootKey: "mcpServers" as const,
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
