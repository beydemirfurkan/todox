import { readEvents } from "./state";
import { owedTasks, windowHours, type Owed } from "./stop";
import type { HookContext, HookOutput } from "./types";

/**
 * What the compaction summary must keep, said before it is written.
 *
 * Compaction is where a long session loses the detail its handoff would have
 * been written from: the decisions made an hour ago, the approach that failed
 * and why. The SessionStart hook puts the *project's* briefing back
 * afterwards, but nothing put back *this session's* unwritten work. Claude
 * Code reads a PreCompact hook's stdout as instructions for the summary, so
 * this names the tasks the session touched that are still owed a write-up,
 * asks the summary to carry what the write-up needs, and asks for the
 * write-up as the first thing after it. Borrowed from mem0's plugins, which
 * flush their capture at the same moment (docs/competitors/mem0.md).
 *
 * It never blocks a compaction -- one blocked near the context limit fails
 * the request outright -- and it says nothing when the session has nothing
 * to keep or the developer opted out ("no-handoff", `TODOX_STOP=off`).
 */

/** Claude Code takes up to 10,000 characters of it; a list of tasks needs far fewer. */
const MAX_CHARS = 4_000;

export async function preCompact(ctx: HookContext): Promise<HookOutput> {
  const { session_id: sessionId, cwd } = ctx.input;
  if (!sessionId || !cwd || ctx.config.stopMode === "off") return null;

  const events = readEvents(ctx.config.dataDir, sessionId);
  if (events.some((e) => e.t === "optout")) return null;

  const taskIds = new Set(events.flatMap((e) => (e.t === "task" ? [e.id] : [])));
  if (taskIds.size === 0) return events.some((e) => e.t === "edit") ? UNTRACKED_EDITS : null;

  const owed = await owedTasks(ctx, cwd, taskIds, windowHours(events, ctx.now()));
  // No token, or the server did not answer: the ids this session touched are
  // still known here, and a summary that keeps too much costs nothing.
  if (owed.length === 0 && !ctx.rpc) return summaryInstructions([...taskIds].map((id) => `- #${id}`));
  if (owed.length === 0) return null;
  return summaryInstructions(owed.map(describeOwed));
}

function describeOwed(task: Owed): string {
  const why = [task.status === "doing" ? "still 'doing'" : null, task.handoff_missing ? "no handoff since its last change" : null]
    .filter(Boolean)
    .join("; ");
  return `- #${task.id} "${task.title}"${why ? `: ${why}` : ""}`;
}

export function summaryInstructions(taskLines: string[]): string {
  return [
    "todox: this session touched tasks it has not written up, and what is not in todox is lost with this compaction.",
    "In the summary, keep for each task below: its id, its true status, the decisions made and why, every approach that failed and why, and the next step.",
    ...taskLines,
    "Also keep this instruction in the summary: right after compaction, before anything else, write these up in todox -- " +
      "update_task to the true status, log_entry(kind:'dead_end') for each failed approach, " +
      "log_entry(kind:'handoff') with the state, the next step and what to watch. Pass your model id.",
  ]
    .join("\n")
    .slice(0, MAX_CHARS);
}

export const UNTRACKED_EDITS =
  "todox: this session edited files but wrote nothing to todox. In the summary, keep what was changed and why, " +
  "and every approach that failed and why. Also keep this instruction: if the work will not finish this session, " +
  "create_task with cwd and log_entry(kind:'handoff') right after compaction; record failed approaches as dead_end.";
