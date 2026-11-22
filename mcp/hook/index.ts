import { createClient } from "../rpc-client";
import { hookClientFrom, normalizeInput, shapeOutput } from "./clients";
import { dataDirFrom, hookConfig, type HookConfig } from "./config";
import { workspaceGit } from "./git";
import { fileLogger, type Logger } from "./log";
import { postToolUse } from "./post-tool-use";
import { preCompact } from "./pre-compact";
import { sessionEnd } from "./session-end";
import { sessionStart } from "./session-start";
import { stop } from "./stop";
import type { HookClient, HookContext, HookInput, HookOutput } from "./types";
import { userPromptSubmit } from "./user-prompt-submit";

/**
 * The Claude Code plugin's command hooks, one entry point for every event.
 *
 * Bundled into `plugin/hooks/todox-hook.mjs` by `pnpm plugin:sync` and run by
 * `plugin/hooks/run.sh <event> [claude-code|codex|cursor]` -- one bundle for
 * the three agents' plugins, which differ only in the hooks file that calls it. A command hook is a plain process: no model
 * call, no transcript parsing, and nothing here can block the developer
 * except the one deliberate case in the Stop hook. Every failure -- todox
 * down, no token, bad input -- prints nothing, exits 0, and leaves a line in
 * `hook.log` under the plugin's data directory.
 */

/** A hook has seconds; a call that has not answered in this long is abandoned. */
const RPC_TIMEOUT_MS = 4_000;

/** Every call says it came from a hook, so it is not counted as the agent's. */
const CARRIER = { "x-todox-carrier": "claude-code-hook" };

/** Generous for anything Claude Code sends a hook, and a cap on what is read. */
const MAX_INPUT_BYTES = 1024 * 1024;

type Handler = (ctx: HookContext) => Promise<HookOutput>;

const HANDLERS: Record<string, Handler> = {
  "session-start": sessionStart,
  "post-tool-use": postToolUse,
  "user-prompt-submit": userPromptSubmit,
  stop,
  "pre-compact": preCompact,
  "session-end": sessionEnd,
};

export async function runHook(
  event: string,
  rawInput: string,
  env: Record<string, string | undefined>,
  client: HookClient = "claude-code",
): Promise<HookOutput> {
  const log = fileLogger(dataDirFrom(env, client));
  const handler = HANDLERS[event];
  if (!handler) {
    log(event, "unknown hook event");
    return null;
  }
  try {
    const config = hookConfig(env, pluginRootFrom(env), (m) => log(event, m), client);
    if (config.disabled) return null;
    const input = normalizeInput(client, parseInput(rawInput));
    return shapeOutput(client, event, await handler(contextFor({ client, config, log, input })));
  } catch (e) {
    log(event, `failed: ${(e as Error).message}`);
    return null;
  }
}

/** Claude Code and Codex both set CLAUDE_PLUGIN_ROOT; Cursor has its own name. */
const pluginRootFrom = (env: Record<string, string | undefined>): string | undefined =>
  env.CLAUDE_PLUGIN_ROOT || env.PLUGIN_ROOT || env.CURSOR_PLUGIN_ROOT || undefined;

function contextFor(parts: { client: HookClient; config: HookConfig; log: Logger; input: HookInput }): HookContext {
  const rpc = parts.config.token
    ? createClient(parts.config.url, parts.config.token, { headers: CARRIER, timeoutMs: RPC_TIMEOUT_MS })
    : null;
  return { ...parts, rpc, now: () => new Date(), git: workspaceGit };
}

function parseInput(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += (chunk as Buffer).length;
    if (size > MAX_INPUT_BYTES) break;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const event = process.argv[2] ?? "";
  const output = await runHook(event, await readStdin(), process.env, hookClientFrom(process.argv[3]));
  if (output) process.stdout.write(typeof output === "string" ? output : JSON.stringify(output));
}

// Only when run as the bundle, never when a test imports this module.
if (process.argv[1]?.endsWith("todox-hook.mjs")) {
  main().catch((e) => {
    process.stderr.write(`todox hook: ${(e as Error).message}\n`);
  });
}
