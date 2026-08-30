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
import { NOTES, QUESTIONS, TASKS, type Question } from "./corpus";
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

  if (termNear.missed.length) {
    console.log("\n  not found even as a term, by any route:");
    for (const q of termNear.missed) console.log(`    · ${q}`);
  }
  return { askedExact, termNear };
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
