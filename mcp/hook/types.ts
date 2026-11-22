import type { ObserverGit } from "../observer";
import type { Checked, RefLike } from "../workspace";
import type { RpcClient } from "../rpc-client";
import type { HookConfig } from "./config";
import type { Logger } from "./log";

/** Which agent ran the hook. Both send the same shapes (`clients.ts`). */
export type HookClient = "claude-code" | "codex";

/** What Claude Code sends a hook on stdin; only the fields read here. */
export interface HookInput {
  session_id?: string;
  cwd?: string;
  source?: string;
  hook_event_name?: string;
  stop_hook_active?: boolean;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  prompt?: string;
  /** PreCompact: "manual" for /compact, "auto" when the context filled. */
  trigger?: string;
}

/**
 * The observer's git reads plus the remote: the one identity that is the same
 * string on every machine, so a checkout at a path todox has not seen yet
 * still finds its project.
 */
export type HookGit = ObserverGit & { remote(dir: string): string | undefined };

export interface HookContext {
  client: HookClient;
  config: HookConfig;
  log: Logger;
  input: HookInput;
  /** Null when there is no token: a hook can still remind, but not ask. */
  rpc: RpcClient | null;
  now: () => Date;
  /** Git on this machine; a fake in tests. */
  git: HookGit;
  /** Hashes linked files on this machine (`checkRefs`); a fake in tests. */
  checkFiles: (refs: RefLike[]) => { checked: Checked[]; seen: { id: number; hash: string | null }[] };
}

/**
 * Printed to stdout: an object as JSON, a string as it is, null as nothing.
 * The string is PreCompact's: Claude Code reads that hook's plain stdout as
 * instructions for the compaction summary, and a JSON object there would be
 * read as text.
 */
export type HookOutput = Record<string, unknown> | string | null;
