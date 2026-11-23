import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { join } from "node:path";

import { REMINDER } from "../mcp/hook/session-start";
import {
  expectedHookBundle,
  expectedSkill,
  expectedVersion,
  HOOK_BUNDLE_PATH,
  MANIFEST_PATH,
  CODEX_MANIFEST_PATH,
  PLUGIN_ROOT,
  SKILL_PATH,
} from "./plugin-sync";
import { importedSpecifiers } from "./bundle-node";

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
  it("points the MCP entry at the hosted endpoint with no header, so it signs in by browser", () => {
    // A header -- even an empty one -- would stop Claude Code from treating
    // the 401 as a reason to run OAuth.
    const mcp = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".mcp.json"), "utf8")) as {
      mcpServers: Record<string, { type: string; url: string; headers?: Record<string, string> }>;
    };
    expect(mcp.mcpServers.todox.type).toBe("http");
    expect(mcp.mcpServers.todox.url).toBe("https://www.todox.dev/api/mcp");
    expect(mcp.mcpServers.todox.headers).toBeUndefined();
  });

  it("asks for a token only optionally, as a sensitive value, and for nothing else", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      userConfig: Record<string, { sensitive?: boolean; required?: boolean }>;
    };
    expect(Object.keys(manifest.userConfig)).toEqual(["token"]);
    expect(manifest.userConfig.token.sensitive).toBe(true);
    expect(manifest.userConfig.token.required).toBe(false);
  });

  it("runs every hook through run.sh, and starts sessions with the digest after compaction too", () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8")) as {
      hooks: Record<string, { matcher?: string; hooks: { type: string; command?: string; timeout?: number }[] }[]>;
    };
    const events: Record<string, string> = {
      SessionStart: "session-start",
      PostToolUse: "post-tool-use",
      UserPromptSubmit: "user-prompt-submit",
      Stop: "stop",
      PreCompact: "pre-compact",
      SessionEnd: "session-end",
    };
    expect(Object.keys(hooks.hooks).sort()).toEqual(Object.keys(events).sort());
    for (const [event, arg] of Object.entries(events)) {
      const [hook] = hooks.hooks[event][0].hooks;
      expect(hook.type).toBe("command");
      expect(hook.command).toBe(`sh "\${CLAUDE_PLUGIN_ROOT}/hooks/run.sh" ${arg}`);
      expect(hook.timeout).toBeLessThanOrEqual(10);
    }
    expect(hooks.hooks.SessionStart[0].matcher?.split("|").sort()).toEqual(["clear", "compact", "resume", "startup"]);
  });

  it("only records the tools the Stop hook reads, through either transport's name", () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8")) as {
      hooks: { PostToolUse: { matcher: string }[] };
    };
    const matcher = new RegExp(`^(?:${hooks.hooks.PostToolUse[0].matcher})$`);
    for (const tool of ["Edit", "Write", "mcp__todox__create_task", "mcp__plugin_todox_todox__log_entry"])
      expect(matcher.test(tool)).toBe(true);
    for (const tool of ["Bash", "Read", "mcp__todox__search", "mcp__todox__get_context"]) expect(matcher.test(tool)).toBe(false);
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
    const specifiers = importedSpecifiers(bundle());
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((s) => !s.startsWith("node:"))).toEqual([]);
    expect(bundle()).not.toMatch(/\brequire\(/);
  });

  it("carries no path from the machine that built it", () => {
    expect(bundle()).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\\\/);
  });
});

/**
 * Codex installs the same directory through its own manifest. Everything it
 * names has to exist, every hook has to reach the one bundle through run.sh
 * with `codex` on the end, and each event must be one the bundle handles -- a
 * misspelt event is a hook that never fires and never errors.
 */
describe("the Codex manifest", () => {
  const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const HANDLED = ["session-start", "post-tool-use", "user-prompt-submit", "stop", "pre-compact", "session-end"];

  it("carries package.json's version", () => {
    expect(read(CODEX_MANIFEST_PATH).version).toBe(expectedVersion());
  });

  it("points at files that exist: the shared skill, its hooks and its MCP entry", () => {
    const manifest = read(CODEX_MANIFEST_PATH) as { skills: string; hooks: string; mcpServers: string };
    expect(manifest.skills).toBe("./skills/");
    for (const file of [manifest.hooks, manifest.mcpServers]) expect(existsSync(join(PLUGIN_ROOT, file))).toBe(true);
  });

  it("runs every hook through run.sh as codex, on events Codex has", () => {
    const hooks = read(join(PLUGIN_ROOT, "hooks", "codex-hooks.json")) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    const CODEX_EVENTS = ["SessionStart", "PostToolUse", "UserPromptSubmit", "Stop", "PreCompact", "PreToolUse"];
    for (const [event, groups] of Object.entries(hooks.hooks)) {
      expect(CODEX_EVENTS).toContain(event);
      const match = /^sh "\$\{PLUGIN_ROOT\}\/hooks\/run\.sh" ([a-z-]+) codex$/.exec(groups[0].hooks[0].command);
      expect(match?.[1] && HANDLED.includes(match[1])).toBe(true);
    }
  });

  it("records apply_patch and the todox task tools, nothing else", () => {
    const hooks = read(join(PLUGIN_ROOT, "hooks", "codex-hooks.json")) as {
      hooks: { PostToolUse: { matcher: string }[] };
    };
    const matcher = new RegExp(`^(?:${hooks.hooks.PostToolUse[0].matcher})$`);
    expect(matcher.test("apply_patch")).toBe(true);
    expect(matcher.test("mcp__todox__update_task")).toBe(true);
    expect(matcher.test("Bash")).toBe(false);
  });

  it("starts the stdio server from the release tarball, passing only todox's variables", () => {
    const mcp = read(join(PLUGIN_ROOT, "codex-mcp.json")) as {
      mcpServers: { todox: { command: string; args: string[]; env_vars: string[] } };
    };
    expect(mcp.mcpServers.todox.command).toBe("npx");
    expect(mcp.mcpServers.todox.args.at(-1)).toMatch(/releases\/latest\/download\/todox-mcp\.tgz$/);
    expect(mcp.mcpServers.todox.env_vars).toEqual(["TODOX_TOKEN", "TODOX_URL"]);
  });

  it("is listed where Codex looks for a marketplace", () => {
    const codex = read(join(PLUGIN_ROOT, "..", ".agents", "plugins", "marketplace.json")) as {
      plugins: { source: { path: string } }[];
    };
    expect(codex.plugins[0].source.path).toBe("./plugin");
  });
});
