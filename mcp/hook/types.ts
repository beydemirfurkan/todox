import type { ObserverGit } from "../observer";
import type { RpcClient } from "../rpc-client";
import type { HookConfig } from "./config";
import type { Logger } from "./log";

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
}

/**
 * The observer's git reads plus the remote: the one identity that is the same
 * string on every machine, so a checkout at a path todox has not seen yet
 * still finds its project.
 */
export type HookGit = ObserverGit & { remote(dir: string): string | undefined };

export interface HookContext {
  config: HookConfig;
  log: Logger;
  input: HookInput;
  /** Null when there is no token: a hook can still remind, but not ask. */
  rpc: RpcClient | null;
  now: () => Date;
  /** Git on this machine; a fake in tests. */
  git: HookGit;
}

/** Printed to stdout as JSON; null prints nothing. */
export type HookOutput = Record<string, unknown> | null;
