import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { HOSTED_URL, hookConfig, urlFromMcpJson } from "./config";

function pluginWith(mcpJson: string): string {
  const root = mkdtempSync(join(tmpdir(), "todox-hook-config-"));
  writeFileSync(join(root, ".mcp.json"), mcpJson);
  return root;
}

const entry = (url: string) => JSON.stringify({ mcpServers: { todox: { type: "http", url } } });

describe("where the hooks find the server", () => {
  it("follows the plugin's own MCP entry, so a self-hoster says it once", () => {
    const root = pluginWith(entry("https://todox.example.com/api/mcp"));
    expect(hookConfig({}, root, vi.fn()).url).toBe("https://todox.example.com");
  });

  it("lets TODOX_URL win, for when a plugin update overwrote that edit", () => {
    const root = pluginWith(entry("https://todox.example.com/api/mcp"));
    expect(hookConfig({ TODOX_URL: "http://localhost:3000" }, root, vi.fn()).url).toBe("http://localhost:3000");
  });

  it("falls back to the hosted server without a plugin root or entry", () => {
    expect(hookConfig({}, undefined, vi.fn()).url).toBe(HOSTED_URL);
    expect(hookConfig({}, mkdtempSync(join(tmpdir(), "todox-hook-empty-")), vi.fn()).url).toBe(HOSTED_URL);
  });

  it("says so when the entry no longer parses, rather than guessing quietly", () => {
    const warn = vi.fn();
    expect(urlFromMcpJson(pluginWith("{ not json"), warn)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/unreadable/));
  });
});

describe("token, data directory and the off switch", () => {
  it("takes the token the plugin already prompts for", () => {
    expect(hookConfig({ CLAUDE_PLUGIN_OPTION_TOKEN: "todox_a" }, undefined, vi.fn()).token).toBe("todox_a");
    expect(hookConfig({}, undefined, vi.fn()).token).toBeUndefined();
  });

  it("keeps state where Claude Code keeps plugin data", () => {
    expect(hookConfig({ CLAUDE_PLUGIN_DATA: "/d" }, undefined, vi.fn()).dataDir).toBe("/d");
  });

  it("turns off on TODOX_HOOKS=off and nothing else", () => {
    expect(hookConfig({ TODOX_HOOKS: "off" }, undefined, vi.fn()).disabled).toBe(true);
    expect(hookConfig({ TODOX_HOOKS: "on" }, undefined, vi.fn()).disabled).toBe(false);
  });
});
