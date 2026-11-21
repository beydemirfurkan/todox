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

export interface HookContext {
  config: HookConfig;
  log: Logger;
  input: HookInput;
  /** Null when there is no token: a hook can still remind, but not ask. */
  rpc: RpcClient | null;
  now: () => Date;
}

/** Printed to stdout as JSON; null prints nothing. */
export type HookOutput = Record<string, unknown> | null;
