import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { expectedSkill, expectedVersion, MANIFEST_PATH, PLUGIN_ROOT, SKILL_PATH } from "./plugin-sync";
import { join } from "node:path";

/**
 * The plugin is the agent surface again, for a client that installs plugins.
 *
 * Its skill is `BASE` and its version is `package.json`'s, and both are files
 * checked in beside the code they copy -- which is exactly the shape that
 * drifts: somebody sharpens a sentence in `mcp/tools.ts`, every transport
 * picks it up at initialize, and the plugin keeps telling a session the old
 * one. `pnpm plugin:sync` rewrites them; this is what fails until it is run.
 */
describe("the plugin says what the server says", () => {
  it("ships the skill the server sends at initialize, verbatim", () => {
    // Line endings folded: a Windows checkout with autocrlf rewrites the file
    // to CRLF on the way in, and that is git's doing, not drift.
    expect(readFileSync(SKILL_PATH, "utf8").replace(/\r\n/g, "\n")).toBe(expectedSkill());
  });

  it("carries package.json's version", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { version: string };
    expect(manifest.version).toBe(expectedVersion());
  });
});

/**
 * The hand-written half, held to the two facts a plugin cannot get wrong
 * silently: the MCP entry reaches the hosted endpoint with the token the
 * install prompts for, and the one hook says the two things the protocol asks.
 */
describe("the plugin's hand-written files", () => {
  it("points the MCP entry at the hosted endpoint with the prompted token", () => {
    const mcp = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".mcp.json"), "utf8")) as {
      mcpServers: Record<string, { type: string; url: string; headers: Record<string, string> }>;
    };
    expect(mcp.mcpServers.todox.type).toBe("http");
    expect(mcp.mcpServers.todox.url).toBe("https://www.todox.dev/api/mcp");
    expect(mcp.mcpServers.todox.headers.Authorization).toBe("Bearer ${user_config.token}");
  });

  it("asks for the token as a sensitive value, and for nothing else", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      userConfig: Record<string, { sensitive?: boolean }>;
    };
    expect(Object.keys(manifest.userConfig)).toEqual(["token"]);
    expect(manifest.userConfig.token.sensitive).toBe(true);
  });

  it("reminds a session at start of the two calls, and does not hook the stop", () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8")) as {
      hooks: Record<string, { hooks: { type: string; command?: string }[] }[]>;
    };
    expect(Object.keys(hooks.hooks)).toEqual(["SessionStart"]);
    const [start] = hooks.hooks.SessionStart[0].hooks;
    expect(start.type).toBe("command");
    expect(start.command).toMatch(/get_context/);
    expect(start.command).toMatch(/session_status/);
  });
});
