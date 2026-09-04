import * as contexts from "../repositories/contexts";
import * as entries from "../repositories/entries";
import * as observations from "../repositories/observations";
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
 *
 * One handoff, not three, and this was a real cost rather than a tidy-up. The
 * map below is what the briefing SHOWS: three decisions, three dead ends, three
 * open questions, and the single newest handoff -- `openTasks` has only ever
 * read `.find(...)` for that one. The other two were fetched across the network
 * on the first query of every session and dropped without being counted, which
 * on the widest project measured (gametable-with-king, 2026-09-04) was 28 KB of
 * a 143 KB payload. The comment under `omitted` already said "there is one
 * shown and one wanted"; now that is true of what is asked for, too.
 */
/**
 * ORDERED, and the order is the spend priority, not decoration.
 *
 * `pageByTasksPerKind` pays for bodies in this order once the round robin
 * below has taken every task's newest of each kind. Handoff first because it
 * is the state the session is resuming from; dead ends next because they are
 * the entries whose whole value is paid by the session that does not read
 * them; questions before decisions because a question nobody answers is
 * cheaper to carry than one nobody sees.
 */
const BRIEFING_KINDS = ["handoff", "dead_end", "question", "decision"] as const;
const PER_KIND = { handoff: 1, decision: 3, dead_end: 3, question: 3 } as const;

/**
 * Bytes of log body carried per briefing.
 *
 * The counterpart of `BRIEFING_NOTES`, and it exists for the same reason that
 * one does, arrived at four months later. Every ceiling above this line is a
 * COUNT ceiling -- fifty tasks, three entries of a kind, six observations --
 * and a count says nothing about bytes when the median entry is 1,737
 * characters and the longest measured is 6,521. Notes were capped by BODY and
 * the log was not, so on 2026-09-04 one production project answered
 * `get_context` with 143 KB: 112 KB of log, and two bytes of notes.
 *
 * Whole or not at all, and never a truncation -- the argument `BRIEFING_NOTES`
 * makes about cutting a decision off mid-sentence applies harder here, because
 * an entry IS the reasoning. What a spent budget leaves behind is the head and
 * the id, and `get_task` returns the rest.
 *
 * Chosen from `pnpm bench:memory`, which prints recall against a curve of
 * budgets, by the rule the note ceiling was chosen with: take the smallest
 * budget at which recall is unchanged, then ship the step above it. The margin
 * is deliberate and is not a hedge -- the benchmark asks whether ONE entry came
 * back, and a briefing is not one answer.
 */
const BRIEFING_LOG_BYTES = 24_576;

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

  const [globalContext, projectContext, logs, counts, files, observed] = await Promise.all([
    contexts.pageByProject(userId, null, notes, focus),
    contexts.pageByProject(userId, project.id, notes, focus),
    entries.pageByTasksPerKind(ids, BRIEFING_KINDS, PER_KIND, BRIEFING_LOG_BYTES),
    // The honest total, and what the caps dropped. Counting in the database is
    // what lets the log above be cut without `entry_count` starting to lie --
    // and a number that lies about how much it is hiding is worse here than a
    // big payload, because the agent stops knowing to go and look.
    entries.countsByTasks(ids),
    refs.listByTasks(ids),
    // Sixth query, and it rides along rather than costing a round trip of its
    // own: the page and its honest total come back together.
    observations.pageByProject(project.id, BRIEFING_OBSERVATIONS),
  ]);

  const openTasks = open.map((t) => {
    const log = logs.rows.get(t.id) ?? [];
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
    // Whole records rather than `{ id, body }` pairs, and the id was already
    // here for the reason the rest now joins it: an agent that reads a record
    // and then wants to do something about it -- answer the question, correct
    // the entry -- could not name it, so acting on one meant a second
    // `get_task` that returns the whole log to find a number the briefing
    // already had in hand. `head` and `created_at` are the same argument: a
    // record you cannot date is one you cannot weigh against a newer one.
    const of = (kind: string) => log.filter((e) => e.kind === kind);
    const decisions = of("decision");
    const dead_ends = of("dead_end");
    const open_questions = of("question");

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
      // The record, not its body. `null` here has always meant "this task has
      // no handoff", and `closingHint` below reads exactly that to decide
      // whether to ask for one -- so a handoff whose body a budget did not pay
      // for must still arrive as an object. Flattening this back to a string
      // would make the briefing end by asking for a handoff that exists.
      last_handoff: handoff ?? null,
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
     * Records carried with a head and no body, because the byte budget was
     * already spent. Beside `context_omitted` rather than on a task, because
     * one budget is spent across the whole briefing.
     *
     * Distinct from `log_omitted`, which counts records the per-kind CAP
     * dropped and which are not in the payload at all. A record counted here
     * IS in the payload -- named, dated and headed -- and `get_task` reads it.
     * Folding the two together would tell an agent that something is missing
     * when in fact it is holding it.
     */
    log_bodies_omitted: logs.bodiesOmitted,
    hint: closingHint(openTasks),
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
 *
 * WHAT THIS TESTS IS EXISTENCE, NOT LEGIBILITY, and the type below is written
 * to make that hard to get wrong. `last_handoff` carries a body the briefing's
 * byte budget may not have paid for, and a handoff nobody can read here is
 * still a handoff -- it is one `get_task` away. Narrowing this to
 * `t.last_handoff?.body == null` compiles, is silent, and puts the
 * always-true sentence back for every task whose handoff fell outside the
 * budget, which on a long log is most of them.
 */
function closingHint(openTasks: { id: number; last_handoff: object | null }[]): string {
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
