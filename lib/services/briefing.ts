import * as contexts from "../repositories/contexts";
import * as entries from "../repositories/entries";
import * as projects from "../repositories/projects";
import * as refs from "../repositories/refs";
import * as tasks from "../repositories/tasks";
import type { Project, SubProjectFlow } from "../types";

/**
 * Everything a cold agent needs to resume work on a project, in one payload.
 * Deliberately opinionated about ordering: global rules first (they constrain
 * everything), then project knowledge, then in-flight work with its log.
 *
 * Four queries regardless of how many tasks are open. Loading the log and the
 * linked files per task would be a round trip each, and this is the call every
 * session starts with.
 */
/**
 * Open tasks carried in one briefing.
 *
 * There was no ceiling, and this is the payload every session opens with: a
 * project that has drifted to two hundred open tasks would spend an agent's
 * context on the backlog before it read a line of code. The list is ordered by
 * priority, so what falls off the end is the least urgent.
 */
const BRIEFING_TASKS = 50;

export async function briefing(userId: number, project: Project) {
  const allOpen = await tasks.listByProject(project.id, "open");
  const open = allOpen.slice(0, BRIEFING_TASKS);
  const ids = open.map((t) => t.id);

  const [globalContext, projectContext, logs, files, subProjects] = await Promise.all([
    contexts.listByProject(userId, null),
    contexts.listByProject(userId, project.id),
    entries.listByTasks(ids),
    refs.listByTasks(ids),
    subProjectFlow(userId, project),
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
    open_tasks_omitted: allOpen.length - open.length,
    stale_refs: stale,
    sub_projects: subProjects,
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

/**
 * Sub-project flow for the briefing and the /p/[slug] panel.
 *
 * If the caller is looking at a sub-project, the flow zooms out to the root
 * of its tree -- the agent that landed in a child path still needs to see the
 * siblings. Two queries: the children list, then one batched GROUP BY for
 * task counts. No N+1.
 */
export async function subProjectFlow(userId: number, project: Project): Promise<SubProjectFlow> {
  const root = project.parent_project_id
    ? (await projects.parentOf(userId, project.id)) ?? project
    : project;

  const children = await projects.listChildren(userId, root.id);
  const counts = await tasks.countsByProject(userId);

  return {
    parent: {
      id: root.id,
      slug: root.slug,
      name: root.name,
      archived: root.archived,
    },
    children: children.map((c) => {
      const c_ = counts.map.get(c.id) ?? counts.empty;
      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        archived: c.archived,
        open_tasks: c_.todo + c_.doing + c_.blocked,
        total_tasks: c_.todo + c_.doing + c_.blocked + c_.done + c_.dropped,
      };
    }),
  };
}

/**
 * Just the staleness lines, for the banner on the project page.
 *
 * Two queries, not the whole briefing. This used to build the entire payload --
 * context notes, every task's log, the lot -- and throw all but this array
 * away, on the page that already loads the tasks and their entries itself.
 */
export async function staleRefs(_userId: number, project: Project): Promise<string[]> {
  const open = await tasks.listByProject(project.id, "open");
  const files = await refs.listByTasks(open.map((t) => t.id));

  return open.flatMap((t) =>
    (files.get(t.id) ?? [])
      .filter((r) => {
        const status = refs.freshness(r);
        return status === "changed" || status === "missing";
      })
      .map((r) => `task #${t.id} "${t.title}" -> ${r.path} (${refs.freshness(r)})`),
  );
}
