import { checkLinkedFiles, STALE_HEADING } from "./linked-files";
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

/** What Claude Code injects whole, less a margin; the stale warning fits under it or is cut. */
export const INJECT_CEILING = 9_900;

/**
 * Fires on startup, resume, /clear and after compaction. The last is the one
 * that earns its keep: compaction is where a long session forgets the
 * briefing it read at the start, and this puts it back.
 */
export async function sessionStart(ctx: HookContext): Promise<HookOutput> {
  recordStart(ctx);
  if (!ctx.rpc) {
    ctx.log("session-start", "no token (CLAUDE_PLUGIN_OPTION_TOKEN or TODOX_TOKEN): reminder only");
    return inject(reminderFor(ctx));
  }
  if (!ctx.input.cwd) return inject(REMINDER);
  const where = { cwd: ctx.input.cwd, ...remoteOf(ctx, ctx.input.cwd) };
  // In parallel with the briefing, not before it: the check is worth a second
  // round trip, never the briefing itself.
  const stale = checkLinkedFiles(ctx, where).catch((e: Error) => {
    ctx.log("session-start", `linked files not checked: ${e.message}`);
    return [] as string[];
  });
  try {
    const result = (await ctx.rpc("getContext", {
      ...where,
      shape: "digest",
      max_chars: DIGEST_CHARS,
      create_if_missing: false,
    })) as { digest?: unknown };
    if (typeof result.digest !== "string") throw new Error("getContext answered without a digest");
    const head = `${PREAMBLE}\n\n${result.digest}`;
    return inject(head + staleWarning(await stale, INJECT_CEILING - head.length));
  } catch (e) {
    ctx.log("session-start", `briefing not fetched, reminder only: ${(e as Error).message}`);
    return inject(reminderFor(ctx));
  }
}

/**
 * The reminder, plus this checkout's identity when the hook can see one.
 *
 * Over the hosted endpoint the server has no disk, so a checkout it has not
 * seen is refused until the agent sends `repo_url` -- and in the lab the
 * agents carried on with a task instead, leaving the repository unregistered.
 * The hook runs where the code is: it can read the remote, so it hands the
 * agent the exact arguments rather than asking it to go and find them.
 */
export function reminderFor(ctx: HookContext): string {
  const cwd = ctx.input.cwd;
  const root = cwd ? ctx.git.root(cwd) : undefined;
  if (!root) return REMINDER;
  const remote = ctx.git.remote(root);
  const identity = remote
    ? `repo_url ${JSON.stringify(remote)} and repo_root ${JSON.stringify(root)}`
    : `repo_root ${JSON.stringify(root)}`;
  return `${REMINDER} This directory is a git checkout: pass ${identity} with cwd on the first get_context, so a repository todox has not seen yet is registered rather than refused.`;
}

function recordStart(ctx: HookContext): void {
  const sessionId = ctx.input.session_id;
  try {
    pruneSessions(ctx.config.dataDir);
    if (sessionId) appendEvent(ctx.config.dataDir, sessionId, { t: "start", at: ctx.now().toISOString(), ...baseline(ctx) });
  } catch (e) {
    ctx.log("session-start", `state not written: ${(e as Error).message}`);
  }
}

/**
 * Where HEAD was when the session opened, so a commit made before the first
 * Stop counts as this session's rather than vanishing into its baseline. Only
 * on a fresh start: a resume or a compaction is the same session continuing,
 * and its first `start` already holds the baseline.
 */
function baseline(ctx: HookContext): { head?: string } {
  if (ctx.input.source && ctx.input.source !== "startup" && ctx.input.source !== "clear") return {};
  const dir = ctx.input.cwd ? ctx.git.root(ctx.input.cwd) : undefined;
  const head = dir ? ctx.git.head(dir) : undefined;
  return head ? { head } : {};
}

/**
 * The remote as a resolution hint: a second checkout of a known repository,
 * at a path todox has not seen, gets its briefing instead of the reminder.
 * It still cannot register anything -- `create_if_missing` stays false.
 */
function remoteOf(ctx: HookContext, cwd: string): { repo_url?: string } {
  const dir = ctx.git.root(cwd);
  const remote = dir ? ctx.git.remote(dir) : undefined;
  return remote ? { repo_url: remote } : {};
}

/**
 * The changed files under their heading, as many lines as fit in `room`. A
 * digest near its ceiling leaves little: the heading and the first file are
 * worth more than a briefing Claude Code spills to a file nobody opens.
 */
export function staleWarning(lines: string[], room: number): string {
  let text = "";
  for (const line of lines) {
    const next = `${text || `\n\n${STALE_HEADING}`}\n${line}`;
    if (next.length > room) break;
    text = next;
  }
  return text;
}

function inject(text: string): HookOutput {
  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } };
}
