import { observeSession } from "./observe";
import { appendEvent, readEvents, type SessionEvent } from "./state";
import type { HookContext, HookOutput } from "./types";

/**
 * The handoff, asked for at the one moment it can still be written.
 *
 * The instructions have always said "before finishing: session_status, then
 * a handoff on every task it names", and measured, agents mostly did not:
 * the rule was clear, the reminder came at the wrong end of the session. A
 * Stop hook comes at the right one. It stops the turn **once per session**,
 * and only for tasks this session itself created or wrote on that are still
 * 'doing' or have changed since their last handoff -- asked of the server,
 * not guessed from the transcript. Everything else passes untouched:
 *
 * - Claude Code says the turn is already a continuation of a stop
 *   (`stop_hook_active`), or this session was stopped once already;
 * - the developer opted out (`TODOX_STOP=off`, or "no-handoff" in a prompt);
 * - the session neither edited the working tree nor touched a todox task.
 *
 * Edits with no todox task at all are the case it cannot judge -- a typo fix
 * owes no task -- so by default it only tells the developer, once, and
 * `TODOX_STOP=strict` turns that into a stop. CONTRIBUTING.md: anything that
 * makes capture more expensive is the trade-off that matters most here, and
 * a hook that blocks every quick fix is exactly that.
 */

/** How far back session_status may look, and how far it must. */
const MAX_WINDOW_HOURS = 168;

export interface Owed {
  id: number;
  title: string;
  status: string;
  handoff_missing: boolean;
}

/**
 * The decision and the git observation run side by side: both are one round
 * trip, and the hook's ten seconds should hold two of them, not wait on each.
 * The observation never decides anything and never throws.
 */
export async function stop(ctx: HookContext): Promise<HookOutput> {
  const [decision] = await Promise.all([decide(ctx), observeSession(ctx)]);
  return decision;
}

async function decide(ctx: HookContext): Promise<HookOutput> {
  const { session_id: sessionId, cwd } = ctx.input;
  if (!sessionId || !cwd || ctx.input.stop_hook_active || ctx.config.stopMode === "off") return null;

  const events = readEvents(ctx.config.dataDir, sessionId);
  if (events.some((e) => e.t === "blocked" || e.t === "optout")) return null;

  const taskIds = new Set(events.flatMap((e) => (e.t === "task" ? [e.id] : [])));
  const edited = events.some((e) => e.t === "edit");
  if (taskIds.size === 0) return edited ? editsWithoutTask(ctx, sessionId, events) : null;

  const owed = await owedTasks(ctx, cwd, taskIds, windowHours(events, ctx.now()));
  if (owed.length === 0) return null;
  appendEvent(ctx.config.dataDir, sessionId, { t: "blocked", at: ctx.now().toISOString() });
  return { decision: "block", reason: handoffReason(owed) };
}

export async function owedTasks(ctx: HookContext, cwd: string, taskIds: Set<number>, hours: number): Promise<Owed[]> {
  if (!ctx.rpc) {
    ctx.log("stop", "no token: cannot ask what this session still owes");
    return [];
  }
  try {
    const status = (await ctx.rpc("sessionStatus", { cwd, hours })) as { yours?: Owed[] };
    // This session's tasks only. `yours` is everything this account touched
    // in the window -- a parallel session in another terminal included -- and
    // stopping this one for that one's work is the false positive that would
    // get the hook switched off.
    return (status.yours ?? []).filter(
      (t) => taskIds.has(t.id) && (t.status === "doing" || t.handoff_missing),
    );
  } catch (e) {
    ctx.log("stop", `session_status failed, not stopping: ${(e as Error).message}`);
    return [];
  }
}

/** From the session's first recorded event, rounded up, plus an hour of slack. */
export function windowHours(events: SessionEvent[], now: Date): number {
  const first = events[0] ? Date.parse(events[0].at) : now.getTime();
  const hours = Math.ceil((now.getTime() - first) / 3_600_000) + 1;
  return Math.min(Math.max(hours, 1), MAX_WINDOW_HOURS);
}

export function handoffReason(owed: Owed[]): string {
  const lines = owed.map((t) => {
    const why = [t.status === "doing" ? "still 'doing'" : null, t.handoff_missing ? "no handoff since your last change" : null]
      .filter(Boolean)
      .join("; ");
    return `- #${t.id} "${t.title}": ${why}`;
  });
  return [
    "todox: this session touched tasks it has not written up.",
    ...lines,
    "For each: update_task to its true status ('done', or back to 'todo'/'blocked' if unfinished); " +
      "log_entry(kind:'dead_end') for any approach that failed; " +
      "log_entry(kind:'handoff') with the state, the next step and what to watch. Pass your model id.",
    "Asked once per session. If the developer asked to stop now, say so and stop.",
  ].join("\n");
}

const NO_TASK_MESSAGE =
  "todox: this session edited files without touching a todox task. If any of it will not finish today, " +
  "ask for a create_task or a handoff before you go. (TODOX_STOP=strict makes this a stop; \"no-handoff\" silences it.)";

const NO_TASK_REASON =
  "todox: this session edited files but wrote nothing to the log. If the work is unfinished, create_task with cwd " +
  "and log_entry(kind:'handoff'); record any failed approach as a dead_end. Pass your model id. " +
  "If none of it is worth keeping, or the developer asked to stop now, say so and stop.";

function editsWithoutTask(ctx: HookContext, sessionId: string, events: SessionEvent[]): HookOutput {
  if (events.some((e) => e.t === "nudged")) return null;
  const at = ctx.now().toISOString();
  if (ctx.config.stopMode === "strict") {
    appendEvent(ctx.config.dataDir, sessionId, { t: "blocked", at });
    return { decision: "block", reason: NO_TASK_REASON };
  }
  appendEvent(ctx.config.dataDir, sessionId, { t: "nudged", at });
  return { systemMessage: NO_TASK_MESSAGE };
}
