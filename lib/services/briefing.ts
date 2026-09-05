import * as contexts from "../repositories/contexts";
import * as entries from "../repositories/entries";
import * as observations from "../repositories/observations";
import * as projects from "../repositories/projects";
import * as refs from "../repositories/refs";
import * as tasks from "../repositories/tasks";
import type { Project, Task } from "../types";

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

/**
 * The kinds a briefing reads, and how many of each it carries per task.
 *
 * The task list was capped and the log under it was not, so fifty tasks could
 * still answer with every entry ever written on any of them -- tens of MB on
 * the call every session opens with, which is the failure `BRIEFING_TASKS` was
 * added to prevent, fixed on one axis only.
 *
 * Notes are absent on purpose: nothing below reads one. They were loaded across
 * the network so that `.length` could count them, and `entry_count` now comes
 * from a COUNT in the database instead.
 *
 * Three is small because these are summaries of a summary. What falls off is
 * the oldest of that kind, and `log_omitted` says how much -- an agent that
 * needs the rest calls `get_task`.
 */
const BRIEFING_KINDS = ["handoff", "decision", "dead_end", "question"] as const;
const PER_KIND = 3;

/**
 * Context note bodies carried per scope -- account-wide and project each.
 *
 * The task list was capped, the log under it was capped, and the notes above
 * both were not: `listByProject` has no LIMIT, so every note this account has
 * ever written came back in full on the call every session opens with. Fifteen
 * notes and two open tasks measured around 39 KB, and nothing in that number
 * grows slower than the log does.
 *
 * The bodies are what cost, so the bodies are what is capped -- every note's
 * title comes back either way, and `context_omitted` counts the ones whose
 * body did not. Deliberately not a truncation: cutting a decision off
 * mid-sentence loses the reasoning that is the whole point of keeping it, and
 * leaves the agent unable to tell a short note from a shortened one. A title
 * with no body is honestly incomplete; half a paragraph is misleading.
 *
 * Sixty rather than fifty: notes are the standing rules, they outlive every
 * task, and there are usually fewer of them than there are open tasks.
 */
const BRIEFING_NOTES = 60;

/**
 * The same ceiling, once somebody has said what the session is about.
 *
 * Fewer, because they are the right ones. Sixty was chosen when the only
 * ordering was recency, and a guess needs breadth to be worth anything -- take
 * the guess away and most of that breadth is notes nobody was going to read.
 * `pnpm bench:memory` puts numbers on it: on a ninety-note project, recall of
 * the note that answers the question is flat from sixty bodies all the way down
 * to eight, while the note payload falls from 43.0 KB to 12.5 KB.
 *
 * Twenty-five rather than the eight the curve would allow, and the margin is
 * deliberate. That measurement asks whether *one* note came back, and a
 * briefing is not one answer -- it is the standing rules an agent has to not
 * break, and most of them are relevant to a session that never asks about them
 * by name. Fitting the number to the benchmark would be fitting it to the wrong
 * question.
 *
 * Two ceilings rather than one, and only because the lower one is not safe
 * without a focus. Nothing sends this parameter yet; dropping the ceiling for
 * everyone would take breadth away from exactly the sessions that still have
 * nothing better than recency to spend it on.
 */
const BRIEFING_NOTES_FOCUSED = 25;

/**
 * Unverified observations carried per briefing.
 *
 * Six, and small on purpose. Everything else in this payload is here because
 * somebody decided it was worth keeping; these are here because a process
 * watched git while the last session ran. They earn their place by answering
 * the one question the log cannot when a session ends badly -- what actually
 * happened to the tree -- and that question is answered by the most recent few
 * or not at all. Reading further back is what `search` and the git history are
 * for.
 *
 * The number came from a measurement rather than a preference, and the first
 * one was wrong. At ten observations carrying ten commit subjects each,
 * `pnpm bench:memory` put the section at 10.2 KB of a 25.0 KB briefing -- the
 * least trustworthy rows in the payload outweighing both the standing notes
 * (8.8 KB) and every open task (5.5 KB), which is precisely backwards. Six
 * observations of three subjects each is 3.2 KB of 18.1 KB.
 *
 * The ratio is the thing to hold, not the constant: this is the part of the
 * briefing nobody asked for, so it has to stay visibly cheaper than the parts
 * somebody did.
 */
const BRIEFING_OBSERVATIONS = 6;

export async function briefing(userId: number, project: Project, focus?: string) {
  const notes = focus ? BRIEFING_NOTES_FOCUSED : BRIEFING_NOTES;

  // Cut in SQL rather than after the fact. This read every open task and then
  // took fifty, on the first query of every session.
  const { rows: open, total } = await tasks.pageByProject(project.id, "open", BRIEFING_TASKS);
  const ids = open.map((t) => t.id);

  const [globalContext, projectContext, logs, counts, files, observed, sameName] = await Promise.all([
    contexts.pageByProject(userId, null, notes, focus),
    contexts.pageByProject(userId, project.id, notes, focus),
    entries.listByTasksPerKind(ids, BRIEFING_KINDS, PER_KIND),
    // The honest total, and what the caps dropped. Counting in the database is
    // what lets the log above be cut without `entry_count` starting to lie --
    // and a number that lies about how much it is hiding is worse here than a
    // big payload, because the agent stops knowing to go and look.
    entries.countsByTasks(ids),
    refs.listByTasks(ids),
    // Sixth query, and it rides along rather than costing a round trip of its
    // own: the page and its honest total come back together.
    observations.pageByProject(project.id, BRIEFING_OBSERVATIONS),
    // Seventh, and in the same Promise.all for the same reason: it costs a
    // connection, not a round trip of latency. `merge_projects` has existed
    // since the cross-machine identity work and nothing has ever pointed at a
    // duplicate that already exists -- the resolver says it once, at the moment
    // of registration, and after that the two rows sit there silently. In
    // production that is two live pairs, one of them a project with twelve open
    // tasks beside a namesake with one.
    projects.listByName(userId, project.name),
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
    // handoff, the recent decisions, and the dead ends (the expensive ones).
    const handoff = [...log].reverse().find((e) => e.kind === "handoff");
    // With the id, because an agent that reads a record and then wants to do
    // something about it -- answer the question, correct the entry -- could not
    // name it. Notes kept their id and entries did not, so acting on one meant a
    // second `get_task` that returns the whole log to find a number the briefing
    // already had in hand.
    const bodies = (kind: string) =>
      log.filter((e) => e.kind === kind).map((e) => ({ id: e.id, body: e.body }));
    const decisions = bodies("decision");
    const dead_ends = bodies("dead_end");
    const open_questions = bodies("question");

    const count = counts.get(t.id);
    // Only the three lists below are capped, so only they can hide anything.
    // The handoff cannot: there is one shown and one wanted.
    const omitted = count
      ? count.decisions -
        decisions.length +
        (count.dead_ends - dead_ends.length) +
        (count.questions - open_questions.length)
      : 0;

    return {
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      body: t.body,
      updated_at: t.updated_at,
      last_handoff: handoff?.body ?? null,
      decisions,
      dead_ends,
      open_questions,
      files: linked,
      entry_count: count?.total ?? 0,
      log_omitted: omitted,
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
    global_context: globalContext.rows,
    project_context: projectContext.rows,
    // One number for both scopes: an agent reads it to decide whether to go
    // looking, and which of the two lists a title sits in is already visible
    // from the lists themselves.
    context_omitted: globalContext.omitted + projectContext.omitted,
    // Which of the two orderings the notes above came back in, because the
    // agent cannot tell by looking and the answer changes what a missing body
    // means. Ranked: what you asked about is at the top and the rest is the
    // newest. Recent: nobody said what this session is about.
    context_ranked_by: focus ? "focus" : "recency",
    open_tasks: openTasks,
    open_tasks_omitted: total - open.length,
    /**
     * What a process saw, as opposed to what anybody wrote down.
     *
     * Its own field rather than more entries, and that separation is the whole
     * design: the log is worth reading because each line is there on purpose,
     * and folding automatic material into it would buy recall by spending
     * exactly that. An agent that finds one of these worth keeping promotes it
     * with `from_observation_id`, which writes the real record and stops the
     * observation coming back.
     */
    observations: observed.rows,
    observations_omitted: observed.omitted,
    stale_refs: stale,
    /**
     * A namesake in the same account, named at the one moment somebody is
     * reading this project rather than six weeks later.
     *
     * Deliberately not an error and deliberately not automatic: two projects
     * with one folder name really can be two repositories (`~/work/api` and
     * `~/personal/api` is the case decision #28 refuses to fuse), so this says
     * what it sees and hands over the call rather than making it.
     */
    ...duplicateOf(userId, project, sameName),
    hint: closingHint(openTasks),
  };
}

/**
 * Whether this project has a namesake, and what to do about it.
 *
 * Returns nothing at all when there is none, so the field is absent rather
 * than null -- a briefing that carries a key meaning "no problem" teaches the
 * reader to skip the key.
 */
function duplicateOf(
  userId: number,
  project: Project,
  sameName: Project[],
): { duplicate?: string } {
  // Owned only. `listByName` answers with projects shared WITH this account
  // too, and `merge_projects` asserts ownership on both sides -- so naming
  // somebody else's project here hands the agent a call that can only 404,
  // about two repositories that were never one. The same distinction
  // `updateProject` and `deleteProject` each carry a comment about.
  // Both sides owned, not just the other one. `merge_projects` asserts
  // ownership on `from` AND `into`, so a member reading a project shared with
  // them was told to merge their own unrelated repo INTO somebody else's --
  // a call that can only 404, about two repositories that were never one.
  if (project.user_id !== userId) return {};
  const others = sameName.filter((p) => p.id !== project.id && p.user_id === userId);
  if (!others.length) return {};
  const list = others.map((p) => `"${p.slug}"`).join(", ");
  return {
    duplicate:
      `Another project in this account is also called "${project.name}" (${list}). ` +
      `If it is the same repository seen from another machine, merge them: ` +
      `merge_projects(from:"<the duplicate>", into:"${project.slug}", confirm:"<the duplicate>"). ` +
      `If they are genuinely two repositories, set repo_url on both with ` +
      `update_project and this stops being asked.`,
  };
}

/**
 * The wrap-up request, naming what is actually missing.
 *
 * It used to be one sentence, identical in every briefing: call `log_entry`
 * with a handoff before you finish. Two accounts in production read that at
 * the top of every session for weeks and wrote nothing, which is roughly what
 * a request that is the same whether or not it applies deserves.
 *
 * The payload already knows the answer -- `last_handoff` is computed for each
 * open task a few lines above -- so the ask can name a number instead of a
 * virtue. Nothing is queried for this.
 *
 * It goes quiet when there is nothing to say. A briefing where every open task
 * carries a handoff should not end by asking for one; that is the same
 * always-true sentence in a different disguise, and it is what teaches an
 * agent to stop reading the last line.
 */
function closingHint(openTasks: { id: number; last_handoff: string | null }[]): string {
  const naked = openTasks.filter((t) => t.last_handoff === null);
  const always =
    "Record dead ends as you hit them, so the next session does not repeat them.";

  if (naked.length === 0) return always;

  // The ids, so the ask is actionable rather than a count to go and match up.
  // Capped: past a handful this is a statement about the backlog, not a list
  // of things to do before finishing.
  const shown = naked.slice(0, 5).map((t) => `#${t.id}`).join(", ");
  const rest = naked.length - 5;

  return (
    `${naked.length} of the open tasks below have no handoff at all (${shown}` +
    `${rest > 0 ? `, +${rest} more` : ""}). If you touch one, leave one: ` +
    `log_entry(kind:'handoff') is what makes the next session cheaper than yours. ` +
    always
  );
}

/**
 * Just the staleness lines, for the banner on the project page.
 *
 * One query, not the whole briefing. This used to build the entire payload --
 * context notes, every task's log, the lot -- and throw all but this array
 * away, on the page that already loads the tasks and their entries itself.
 *
 * It then still fetched the project's open tasks for itself, on a page that
 * had just fetched every task in the project: the same table, twice, in the
 * same render. It takes the tasks now, so the caller's list is the only one.
 * It also took a user id it never used -- the tasks it is handed have already
 * been through the account's own read.
 */
export async function staleRefs(open: Task[]): Promise<string[]> {
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
