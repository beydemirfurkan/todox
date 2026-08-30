/**
 * `pnpm bench:memory` — what a session pays, and what it gets back.
 *
 * Two numbers. The briefing is the call every session is told to make first, so
 * its size is a tax on every session that will ever run; and search is the call
 * an agent makes once it has a question, so whether it answers is the
 * difference between a log and a log nobody can reach.
 *
 * Neither is a score to beat. They exist because the work queued behind them --
 * full-text search, and spending the briefing's budget on what is relevant --
 * both end in the sentence "that made it better", and without a run that
 * sentence is a belief. Deliberately no threshold: a number with a threshold
 * becomes the target, which is the same reason `pnpm test:coverage` has none.
 *
 * It seeds its own corpus into a throwaway account and removes it afterwards,
 * so it can run against any database, including CI's. It does not read anybody's
 * real log: a benchmark that needs production data is one nobody else can run,
 * and one whose corpus moves underneath it cannot compare two runs.
 */
import "../env";

import * as contextsRepo from "../../lib/repositories/contexts";
import * as projectsRepo from "../../lib/repositories/projects";
import * as usersRepo from "../../lib/repositories/users";
import { briefing } from "../../lib/services/briefing";
import { search } from "../../lib/services/search";
import * as taskService from "../../lib/services/task-service";
import { hashPassword } from "../../lib/util/password";
import { filler, NOTES, QUESTIONS, TASKS, UNANSWERABLE, type Question } from "./corpus";
import { approxTokens, bytes, kb, reachableWithin, recallAt, score, type Hit } from "./measure";

const USERNAME = "memory-bench";
const SLUG = "memory-bench";
const AT = 5;

const row = (label: string, value: string) => `  ${label.padEnd(34)}${value.padStart(12)}`;

async function seed() {
  const user =
    (await usersRepo.byUsername(USERNAME)) ??
    (await usersRepo.create({
      username: USERNAME,
      email: `${USERNAME}@todox.local`,
      name: "memory bench",
      password_hash: await hashPassword("memory-bench"),
    }));

  // A previous run that died before its cleanup would otherwise double the
  // corpus and quietly change every number in this report.
  const stale = await projectsRepo.bySlug(user.id, SLUG);
  if (stale) await projectsRepo.remove(user.id, stale.id);
  for (const note of await contextsRepo.listByProject(user.id, null))
    await contextsRepo.remove(note.id);

  const project = await projectsRepo.create(user.id, {
    name: "memory bench",
    slug: SLUG,
    root_path: "/bench/repo",
    summary: "A fixed corpus, seeded and removed by pnpm bench:memory.",
  });

  for (const note of NOTES)
    await contextsRepo.create({ user_id: user.id, project_id: project.id, ...note });

  for (const t of TASKS) {
    const task = await taskService.create({
      project_id: project.id,
      title: t.title,
      body: t.body,
      user_id: user.id,
    });
    for (const e of t.entries)
      await taskService.addEntry({ task_id: task.id, kind: e.kind, body: e.body, user_id: user.id });
  }

  return { user, project };
}

/** What the briefing costs, and which part of it is doing the spending. */
async function reportBriefing(userId: number, project: Awaited<ReturnType<typeof seed>>["project"]) {
  const brief = await briefing(userId, project);
  const tasks = brief.open_tasks;

  const sum = (pick: (t: (typeof tasks)[number]) => unknown) => tasks.reduce((n, t) => n + bytes(pick(t)), 0);

  console.log(`\nBRIEFING  —  ${brief.open_tasks.length} open tasks, ${brief.project_context.length} notes\n`);
  console.log(row("global_context", kb(bytes(brief.global_context))));
  console.log(row("project_context", kb(bytes(brief.project_context))));
  console.log(row("open_tasks", kb(bytes(tasks))));
  console.log(row("  of which task bodies", kb(sum((t) => t.body))));
  console.log(row("  of which last handoffs", kb(sum((t) => t.last_handoff))));
  console.log(row("  of which dead ends", kb(sum((t) => t.dead_ends))));
  console.log(row("  of which decisions", kb(sum((t) => t.decisions))));
  console.log(row("stale_refs", kb(bytes(brief.stale_refs))));
  console.log(row("─".repeat(20), ""));
  console.log(row("total", kb(bytes(brief))));
  console.log(row("≈ tokens (see CHARS_PER_TOKEN)", `${approxTokens(brief)}`));
  console.log(
    row("left out", `${brief.context_omitted} notes, ${brief.open_tasks_omitted} tasks`),
  );
  return brief;
}

/**
 * What the ceiling actually does, by adding notes until it bites.
 *
 * The point is the shape, not any one row: below the cap the payload tracks the
 * corpus, and above it stops. Bodies are reused from the corpus rather than
 * generated, so the sizes are the sizes real notes have.
 */
async function reportGrowth(userId: number, project: Awaited<ReturnType<typeof seed>>["project"]) {
  console.log("\nGROWTH  —  what the cap is for\n");
  console.log(row("notes in the project", "briefing"));

  for (const target of [18, 40, 60, 90, 140]) {
    const have = (await contextsRepo.listByProject(userId, project.id)).length;
    for (let i = have; i < target; i++) {
      const source = NOTES[i % NOTES.length];
      await contextsRepo.create({
        user_id: userId,
        project_id: project.id,
        kind: source.kind,
        title: `${source.title} (${i})`,
        body: source.body,
      });
    }
    const brief = await briefing(userId, project);
    const omitted = brief.context_omitted ? `  (${brief.context_omitted} without a body)` : "";
    console.log(row(`${target}`, `${kb(bytes(brief))}${omitted}`));
  }
}

/**
 * The same questions asked two ways.
 *
 * `search` matches a literal substring, so the phrasing is not a detail — it is
 * the whole result. The tool description used to invite the first column and
 * now asks for the second, and this is the run that says how much that is
 * worth. It is also the baseline any full-text work has to beat.
 */
async function reportRecall(userId: number, answers: Map<string, Hit>) {
  const run = async (phrasing: (q: Question) => string) =>
    Promise.all(
      QUESTIONS.map(async (q) => ({
        question: q.asked,
        expected: answers.get(q.answer)!,
        hits: (await search(userId, phrasing(q), AT)).map((h) => ({
          type: h.type,
          id: h.id,
          task_id: h.task_id,
        })),
      })),
    );

  const [asQuestion, asTerm] = [await run((q) => q.asked), await run((q) => q.term)];

  const askedExact = recallAt(AT, asQuestion);
  const askedNear = recallAt(AT, asQuestion, reachableWithin);
  const termExact = recallAt(AT, asTerm);
  const termNear = recallAt(AT, asTerm, reachableWithin);

  console.log(`\nSEARCH  —  ${QUESTIONS.length} questions, recall@${AT}\n`);
  console.log(row("", "  the row   reachable"));
  console.log(row("asked as a question", `${score(askedExact)}${score(askedNear)}`));
  console.log(row("asked as a distinctive term", `${score(termExact)}${score(termNear)}`));

  // Both columns name what they missed. The question column is the one that
  // moves when the query parser changes, so a run that drops one has to say
  // which -- a score that only goes down by a number cannot be argued with.
  // The other half of the number. Recall says the right row came back; this says
  // how much came with it, and a log that answers a question it has never heard
  // of is worse than one that says nothing -- the agent has no way to tell the
  // difference and every reason to trust it.
  const noise = await Promise.all(UNANSWERABLE.map((q) => search(userId, q, 30)));
  const total = noise.reduce((n, hits) => n + hits.length, 0);
  console.log(
    row(
      "questions it cannot answer",
      `${total} hits / ${UNANSWERABLE.length} asked`,
    ),
  );

  if (askedNear.missed.length) {
    console.log("\n  not reachable when asked as a question:");
    for (const q of askedNear.missed) console.log(`    · ${q}`);
  }
  if (termNear.missed.length) {
    console.log("\n  not found even as a term, by any route:");
    for (const q of termNear.missed) console.log(`    · ${q}`);
  }
  return { askedExact, termNear };
}

/**
 * The other half of what the briefing costs: not how big it is, but whether
 * what it spent the budget on was the right thing.
 *
 * The ceiling keeps every note's title and the newest `BRIEFING_NOTES` bodies.
 * Recency is a guess about relevance and it is a bad one — a standing rule
 * written a year ago is exactly the kind of thing that matters and exactly the
 * kind of thing recency buries. This measures the guess by asking, for each
 * question the corpus can answer, whether the briefing actually carried the
 * body that answers it.
 *
 * Below the ceiling both orderings score the same and must: nothing is being
 * cut, so nothing can be cut wrongly. The number only means something once
 * there are more notes than budget, which is what the filler is for.
 */
async function reportFocus(userId: number, project: Awaited<ReturnType<typeof seed>>["project"]) {
  // Only the questions a note answers. A task's body is not on this budget.
  const asked = QUESTIONS.filter((q) => q.answerType === "context");

  console.log("\nFOCUS  —  did the briefing carry the body that answers the question?\n");
  console.log(row("notes in the project", "  recency   with focus"));

  const carriedBody = (brief: Awaited<ReturnType<typeof briefing>>, title: string) =>
    [...brief.global_context, ...brief.project_context].some(
      (n) => n.title === title && n.body !== null,
    );

  // Everything this function adds, so it can put the project back as it found
  // it. `reportGrowth` measures bytes on the same project and would otherwise
  // start from a corpus this one had already tripled.
  const added: number[] = [];
  let missed: string[] = [];

  for (const target of [18, 90]) {
    const have = (await contextsRepo.listByProject(userId, project.id)).length;
    for (let i = have; i < target; i++)
      added.push(
        (await contextsRepo.create({ user_id: userId, project_id: project.id, ...filler(i) })).id,
      );

    // One briefing serves every question when nobody said what the session is
    // about; with a focus each question is its own session, so each gets one.
    const byRecency = await briefing(userId, project);
    const recency = asked.filter((q) => carriedBody(byRecency, q.answer)).length;

    const focused = await Promise.all(
      asked.map(async (q) => ({
        q,
        hit: carriedBody(await briefing(userId, project, q.asked), q.answer),
      })),
    );
    missed = focused.filter((f) => !f.hit).map((f) => f.q.asked);

    const pct = (n: number) =>
      `${String(n).padStart(2)}/${asked.length} (${String(Math.round((n / asked.length) * 100)).padStart(3)}%)`;
    console.log(row(`${target}`, `${pct(recency)} ${pct(asked.length - missed.length)}`));
  }

  if (missed.length) {
    // Focus inherits whatever `ts_rank` does not reach, which is the same limit
    // the SEARCH block above reports -- not a separate defect.
    console.log("\n  still past the ceiling even with a focus:");
    for (const q of missed) console.log(`    · ${q}`);
  }

  // What the ceiling could be, now that the budget is spent on purpose.
  //
  // Ranking better is only half an answer: it makes the same payload more
  // useful without making it smaller. The number worth knowing is how far the
  // ceiling can come down before recall starts paying for it, and that is a
  // curve rather than an opinion. Measured against the repository directly,
  // because the briefing's own ceiling is a constant and the point here is to
  // vary it.
  console.log("\n  what the ceiling costs, at 90 notes and with a focus:\n");
  console.log(row("  bodies carried", "recall     note bytes"));

  for (const budget of [60, 40, 25, 15, 8]) {
    const pages = await Promise.all(
      asked.map((q) => contextsRepo.pageByProject(userId, project.id, budget, q.asked)),
    );
    const found = pages.filter((page, i) =>
      page.rows.some((n) => n.title === asked[i].answer && n.body !== null),
    ).length;
    // One question's payload, since each is its own session. The median rather
    // than the mean: one very long note should not describe the typical cost.
    const sizes = pages.map((p) => bytes(p.rows)).sort((a, b) => a - b);
    console.log(
      row(
        `  ${budget}`,
        `${String(found).padStart(2)}/${asked.length} (${String(Math.round((found / asked.length) * 100)).padStart(3)}%) ${kb(sizes[Math.floor(sizes.length / 2)])}`,
      ),
    );
  }

  for (const id of added) await contextsRepo.remove(id);
}

async function main() {
  const { user, project } = await seed();
  try {
    const notes = await contextsRepo.listByProject(user.id, project.id);
    const tasks = (await import("../../lib/repositories/tasks")).listByProject(project.id, "all");
    const answers = new Map<string, Hit>([
      ...notes.map((n): [string, Hit] => [n.title, { type: "context", id: n.id }]),
      ...(await tasks).map((t): [string, Hit] => [t.title, { type: "task", id: t.id }]),
    ]);

    const unresolved = QUESTIONS.filter((q) => !answers.has(q.answer));
    if (unresolved.length)
      throw new Error(
        `the corpus and the questions disagree; no record titled: ${unresolved
          .map((q) => q.answer)
          .join(", ")}`,
      );

    await reportBriefing(user.id, project);
    await reportRecall(user.id, answers);
    // Both of these grow the project's notes, so they run last and in this
    // order: recall needs filler that answers nothing, growth wants realistic
    // bodies, and neither can be measured after the other has seeded.
    await reportFocus(user.id, project);
    await reportGrowth(user.id, project);
    console.log("\ndone. Nothing here is a threshold; both numbers are for comparing two runs.\n");
  } finally {
    // The corpus is removed whatever happened, so a failed run does not leave a
    // project behind that the next one would seed on top of.
    await projectsRepo.remove(user.id, project.id);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
