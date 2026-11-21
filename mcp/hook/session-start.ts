import { appendEvent, pruneSessions } from "./state";
import type { HookContext, HookOutput } from "./types";

/**
 * The reminder the plugin has always given, and still gives whenever the
 * briefing itself cannot be fetched: no token, todox unreachable, or a
 * directory that is not a registered project (a hook never registers one --
 * that is the agent's call, made with get_context).
 */
export const REMINDER =
  "todox is connected. Before non-trivial work: get_context with cwd (it registers a new repo by itself). Before finishing: session_status with cwd, then update_task, dead_ends and a handoff on every task it names.";

/** Said above an injected briefing, so the agent knows nobody has to fetch it. */
export const PREAMBLE =
  "todox fetched this project's briefing for you (digest; get_context with a focus has the bodies). Before finishing: session_status with cwd, then a handoff on every task it names.";

/**
 * The digest's ceiling. Claude Code injects at most 10,000 characters of a
 * SessionStart hook's context and spills the rest to a file it never asks the
 * agent to open, so the digest, the preamble and the blank line between them
 * stay under that with room to spare.
 */
export const DIGEST_CHARS = 9_200;

/**
 * Fires on startup, resume, /clear and after compaction. The last is the one
 * that earns its keep: compaction is where a long session forgets the
 * briefing it read at the start, and this puts it back.
 */
export async function sessionStart(ctx: HookContext): Promise<HookOutput> {
  recordStart(ctx);
  if (!ctx.rpc) {
    ctx.log("session-start", "no token (CLAUDE_PLUGIN_OPTION_TOKEN): reminder only");
    return inject(REMINDER);
  }
  if (!ctx.input.cwd) return inject(REMINDER);
  try {
    const result = (await ctx.rpc("getContext", {
      cwd: ctx.input.cwd,
      shape: "digest",
      max_chars: DIGEST_CHARS,
      create_if_missing: false,
    })) as { digest?: unknown };
    if (typeof result.digest !== "string") throw new Error("getContext answered without a digest");
    return inject(`${PREAMBLE}\n\n${result.digest}`);
  } catch (e) {
    ctx.log("session-start", `briefing not fetched, reminder only: ${(e as Error).message}`);
    return inject(REMINDER);
  }
}

function recordStart(ctx: HookContext): void {
  const sessionId = ctx.input.session_id;
  try {
    pruneSessions(ctx.config.dataDir);
    if (sessionId) appendEvent(ctx.config.dataDir, sessionId, { t: "start", at: ctx.now().toISOString() });
  } catch (e) {
    ctx.log("session-start", `state not written: ${(e as Error).message}`);
  }
}

function inject(text: string): HookOutput {
  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } };
}
