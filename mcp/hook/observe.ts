import { MAX_TASK_IDS, observationPayload } from "../observer";
import type { RpcClient } from "../rpc-client";
import { appendEvent, readEvents, type SessionEvent } from "./state";
import type { HookContext } from "./types";

/**
 * The second carrier for observations: what git did while this Claude Code
 * session ran, sent at Stop and at SessionEnd.
 *
 * The stdio process has always done this, and every hosted account has
 * always had an empty `observations` section, because the hosted endpoint
 * has no process on the developer's machine (dead end on task #174). The
 * plugin's hooks are one. Counts, three subject lines and task ids -- the
 * same params as the stdio observer, built by the same function -- and never
 * a diff, a path or the transcript.
 *
 * Quiet in the same ways: a session that changed nothing sends nothing, a
 * state already sent is not sent again, and a server that says the stdio
 * process already has this session (`skipped: "stdio_active"`) is believed.
 * The window widens backwards once, to the last HEAD the server recorded,
 * which is what recovers the work of a session that died unreported.
 */
export const HOOK_CLIENT = "claude-code-plugin";

interface Observing {
  ctx: HookContext;
  rpc: RpcClient;
  sessionId: string;
  cwd: string;
}

export async function observeSession(ctx: HookContext): Promise<void> {
  const { session_id: sessionId, cwd } = ctx.input;
  if (!ctx.config.observe || !ctx.rpc || !sessionId || !cwd) return;
  try {
    await observe({ ctx, rpc: ctx.rpc, sessionId, cwd });
  } catch (e) {
    ctx.log("observe", `not recorded: ${(e as Error).message}`);
  }
}

async function observe({ ctx, rpc, sessionId, cwd }: Observing): Promise<void> {
  const { git } = ctx;
  const dir = git.root(cwd);
  const head = dir ? git.head(dir) : undefined;
  if (!dir || !head) return;

  const events = readEvents(ctx.config.dataDir, sessionId);
  const start = events.find((e): e is Extract<SessionEvent, { t: "start" }> => e.t === "start");
  const observed = events.filter((e): e is Extract<SessionEvent, { t: "observed" }> => e.t === "observed");
  const last = observed.at(-1);
  const base = last?.base ?? start?.head ?? head;
  const taskIds = [...new Set(events.flatMap((e) => (e.t === "doing" ? [e.id] : [])))].slice(0, MAX_TASK_IDS);
  const dirty = git.dirty(dir) ?? 0;
  const since = git.since(dir, base);
  const commits = since?.count ?? 0;

  if (commits === 0 && dirty === 0 && taskIds.length === 0) return;
  if (last && last.head === head && last.dirty === dirty && last.tasks === taskIds.length) return;

  const facts = {
    dir,
    sessionId: `cc:${sessionId}`,
    client: HOOK_CLIENT,
    branch: git.branch(dir),
    base,
    head,
    commits,
    subjects: since?.subjects ?? [],
    dirty,
    taskIds,
    startedAt: start?.at ?? ctx.now().toISOString(),
  };
  const send = (f: typeof facts) =>
    rpc("recordObservation", { ...observationPayload(f), source: "claude-code-hook" }) as Promise<{
      last_head_sha?: string | null;
      skipped?: string;
    }>;

  const reply = await send(facts);
  let sentBase = base;
  // Once per session: only the first write may widen, the gap is in the past.
  const previous = reply.last_head_sha;
  if (!reply.skipped && !last && previous && previous !== base) {
    const wider = git.since(dir, previous);
    if (wider) {
      await send({ ...facts, base: previous, commits: wider.count, subjects: wider.subjects });
      sentBase = previous;
    }
  }
  appendEvent(ctx.config.dataDir, sessionId, {
    t: "observed",
    at: ctx.now().toISOString(),
    base: sentBase,
    head,
    dirty,
    tasks: taskIds.length,
  });
}
