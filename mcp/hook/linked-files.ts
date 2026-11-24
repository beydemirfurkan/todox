import type { Checked, RefLike } from "../workspace";
import type { HookContext } from "./types";

/**
 * Staleness for agents connected over the hosted endpoint.
 *
 * The server has no copy of the repository, so a linked file's status is only
 * as fresh as the last hash somebody reported, and the hosted tools leave that
 * to the agent. In practice the agent almost never does it. As a result the
 * Claude Code plugin, which talks to the hosted endpoint, never flagged a note
 * whose file had changed. This hook runs on the machine that has the code, so
 * at session start it hashes the files linked to open tasks and reports them,
 * the same way the stdio process does on every read.
 */

/** Past this, the briefing matters more than the check: skip the report. */
const REPORT_BUDGET_MS = 3_000;

/** How many changed files the injected warning names before it says "+N more". */
const NAMED = 8;

interface LinkedTask {
  id: number;
  title: string;
  refs: RefLike[];
}

/** The linked files of each open task, as the full briefing hands them out. */
export function linkedTasks(brief: unknown): LinkedTask[] {
  const tiers = brief as { open_tasks?: unknown; condensed_tasks?: unknown } | null;
  const open = [tiers?.open_tasks, tiers?.condensed_tasks].flatMap((tier) => (Array.isArray(tier) ? tier : []));
  return open.flatMap((t: { id?: unknown; title?: unknown; files?: unknown }) => {
    if (typeof t?.id !== "number" || !Array.isArray(t.files)) return [];
    const refs = t.files
      .filter((f: { id?: unknown; path?: unknown }) => typeof f?.id === "number" && typeof f?.path === "string")
      .map((f: { id: number; path: string; hash?: unknown }) => ({
        id: f.id,
        path: f.path,
        hash: typeof f.hash === "string" ? f.hash : null,
      }));
    return refs.length ? [{ id: t.id, title: typeof t.title === "string" ? t.title : "", refs }] : [];
  });
}

/**
 * Hashes the open tasks' linked files, reports what it found, and returns one
 * line per file that changed or went missing since its note was written.
 */
export async function checkLinkedFiles(ctx: HookContext, args: Record<string, unknown>): Promise<string[]> {
  if (!ctx.rpc) return [];
  const started = Date.now();
  const tasks = linkedTasks(await ctx.rpc("getContext", { ...args, create_if_missing: false }));
  if (!tasks.length) return [];

  const result = ctx.checkFiles(tasks.flatMap((t) => t.refs));
  if (result.seen.length && Date.now() - started < REPORT_BUDGET_MS) {
    try {
      await ctx.rpc("reportRefs", { refs: result.seen });
    } catch (e) {
      ctx.log("session-start", `linked files hashed but not reported: ${(e as Error).message}`);
    }
  }
  return staleLines(tasks, result.checked);
}

function staleLines(tasks: LinkedTask[], checked: Checked[]): string[] {
  const status = new Map(checked.map((c) => [c.id, c.status]));
  const lines = tasks.flatMap((t) =>
    t.refs
      .filter((r) => status.get(r.id) === "changed" || status.get(r.id) === "missing")
      .map((r) => `- task #${t.id} "${t.title}" -> ${r.path} (${status.get(r.id)})`),
  );
  return lines.length > NAMED ? [...lines.slice(0, NAMED), `- +${lines.length - NAMED} more`] : lines;
}

/** Said above the lines, so the agent knows what to do with them. */
export const STALE_HEADING =
  "Checked on this machine just now: these linked files changed or went missing after their note was written. Read the change before trusting the note (get_file_context with the path), then accept_file_change if the note still holds.";
