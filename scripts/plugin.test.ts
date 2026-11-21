import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { join } from "node:path";

import { REMINDER } from "../mcp/hook/session-start";
import {
  expectedHookBundle,
  expectedSkill,
  expectedVersion,
  HOOK_BUNDLE_PATH,
  MANIFEST_PATH,
  PLUGIN_ROOT,
  SKILL_PATH,
} from "./plugin-sync";

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

  it("runs every hook through run.sh, and starts sessions with the digest after compaction too", () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8")) as {
      hooks: Record<string, { matcher?: string; hooks: { type: string; command?: string; timeout?: number }[] }[]>;
    };
    expect(Object.keys(hooks.hooks)).toEqual(["SessionStart"]);
    const [group] = hooks.hooks.SessionStart;
    expect(group.matcher?.split("|").sort()).toEqual(["clear", "compact", "resume", "startup"]);
    const [start] = group.hooks;
    expect(start.type).toBe("command");
    expect(start.command).toBe('sh "${CLAUDE_PLUGIN_ROOT}/hooks/run.sh" session-start');
    expect(start.timeout).toBeLessThanOrEqual(10);
  });

  it("still gives the reminder at start on a machine with no node, word for word", () => {
    const runner = readFileSync(join(PLUGIN_ROOT, "hooks", "run.sh"), "utf8");
    expect(runner).toContain(`echo "${REMINDER}"`);
    expect(REMINDER).toMatch(/get_context/);
    expect(REMINDER).toMatch(/session_status/);
    expect(runner).toMatch(/exit 0/);
  });
});

/**
 * The hooks are TypeScript in `mcp/hook/` and a single generated file in the
 * plugin, which is the same drift as the skill: change the source, forget the
 * sync, and every installed plugin runs the old hook.
 */
describe("the hook bundle", () => {
  const bundle = () => readFileSync(HOOK_BUNDLE_PATH, "utf8").replace(/\r\n/g, "\n");

  it("is mcp/hook/ as it stands, built", () => {
    expect(bundle()).toBe(expectedHookBundle());
  });

  it("imports nothing but node's built-ins, because a plugin has no node_modules", () => {
    const specifiers = [...bundle().matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((s) => !s.startsWith("node:"))).toEqual([]);
    expect(bundle()).not.toMatch(/\brequire\(/);
  });

  it("carries no path from the machine that built it", () => {
    expect(bundle()).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\\\/);
  });
});
