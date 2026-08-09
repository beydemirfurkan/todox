import * as contexts from "../repositories/contexts";
import * as entries from "../repositories/entries";
import * as refs from "../repositories/refs";
import * as tasks from "../repositories/tasks";
import type { Project } from "../types";

/**
 * Everything a cold agent needs to resume work on a project, in one payload.
 * Deliberately opinionated about ordering: global rules first (they constrain
 * everything), then project knowledge, then in-flight work with its log.
 *
 * Four queries regardless of how many tasks are open. Loading the log and the
 * linked files per task would be a round trip each, and this is the call every
 * session starts with.
 */
export async function briefing(userId: number, project: Project) {
  const open = await tasks.listByProject(project.id, "open");
  const ids = open.map((t) => t.id);

  const [globalContext, projectContext, logs, files] = await Promise.all([
    contexts.listByProject(userId, null),
    contexts.listByProject(userId, project.id),
    entries.listByTasks(ids),
    refs.listByTasks(ids),
  ]);

  const openTasks = open.map((t) => {
    const log = logs.get(t.id) ?? [];
    // `hash` and `id` go out so the agent can check the file itself and report
    // back — this process has no copy of the repository, so the status here is
    // only ever as fresh as the last thing an agent told us.
    const linked = (files.get(t.id) ?? []).map((r) => ({
      id: r.id,
      path: r.path,
      note: r.note,
      hash: r.hash,
      status: refs.freshness(r),
      checked_at: r.checked_at,
    }));
    // A cold agent needs the shape of the work, not every keystroke: the last
    // handoff, every decision, and every dead end (the expensive ones).
    const handoff = [...log].reverse().find((e) => e.kind === "handoff");
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      body: t.body,
      updated_at: t.updated_at,
      last_handoff: handoff?.body ?? null,
      decisions: log.filter((e) => e.kind === "decision").map((e) => e.body),
      dead_ends: log.filter((e) => e.kind === "dead_end").map((e) => e.body),
      open_questions: log.filter((e) => e.kind === "question").map((e) => e.body),
      files: linked,
      entry_count: log.length,
    };
  });

  const stale = openTasks.flatMap((t) =>
    t.files
      .filter((f) => f.status === "changed" || f.status === "missing")
      .map((f) => `task #${t.id} "${t.title}" -> ${f.path} (${f.status})`),
  );

  return {
    project: {
      slug: project.slug,
      name: project.name,
      root_path: project.root_path,
      summary: project.summary,
    },
    global_context: globalContext.map(strip),
    project_context: projectContext.map(strip),
    open_tasks: openTasks,
    stale_refs: stale,
    hint:
      "Before you finish, call log_entry(kind:'handoff') on any task you touched, " +
      "and record dead ends so the next session does not repeat them.",
  };
}

const strip = (c: { id: number; kind: string; title: string; body: string }) => ({
  id: c.id,
  kind: c.kind,
  title: c.title,
  body: c.body,
});

/** Just the staleness lines, for the banner on the project page. */
export async function staleRefs(userId: number, project: Project): Promise<string[]> {
  return (await briefing(userId, project)).stale_refs;
}
