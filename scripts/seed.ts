/**
 * Demo data so a fresh install has something to look at. Safe to re-run: it
 * skips anything that already exists.
 *
 * Paths point at this checkout rather than at any particular machine, so the
 * staleness demo works wherever the repo happens to live.
 */
import "./env";

import { resolve } from "node:path";

import * as contextsRepo from "../lib/repositories/contexts";
import * as projectsRepo from "../lib/repositories/projects";
import * as refsRepo from "../lib/repositories/refs";
import * as tasksRepo from "../lib/repositories/tasks";
import * as usersRepo from "../lib/repositories/users";
import * as taskService from "../lib/services/task-service";
import { hashPassword } from "../lib/util/password";

const DEMO = {
  username: "demo",
  email: "demo@todox.local",
  name: "Demo",
  password: "todox-demo",
};

const REPO = resolve(process.cwd());

async function demoUser() {
  const existing = await usersRepo.byUsername(DEMO.username);
  if (existing) return existing;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "refusing to create the demo account in production: it has a published password",
    );
  }

  return usersRepo.create({
    username: DEMO.username,
    email: DEMO.email,
    name: DEMO.name,
    password_hash: await hashPassword(DEMO.password),
  });
}

async function main() {
  const user = await demoUser();

  const project = async (input: projectsRepo.NewProject) =>
    (await projectsRepo.bySlug(user.id, input.slug ?? input.name.toLowerCase())) ??
    projectsRepo.create(user.id, input);

  const todox = await project({
    name: "todox",
    slug: "todox",
    root_path: REPO,
    summary:
      "This app. Working memory for a developer and their agents. Next.js + Postgres, plus an MCP server that is the primary write path.",
  });

  // A second project so the demo shows cross-project context and a report
  // with more than one row in it. Deliberately invented.
  const example = await project({
    name: "Example Service",
    slug: "example-service",
    summary:
      "A stand-in project, here only to show what a second one looks like. Delete it once you have your own.",
  });

  if (!(await contextsRepo.listByProject(user.id, null)).length) {
    await contextsRepo.create({
      user_id: user.id,
      project_id: null,
      kind: "preference",
      title: "Say what the change is before making it",
      body: "For anything larger than a bug fix: state the approach and the trade-offs, get a yes, then build. An example of a standing rule that applies to every project.",
    });
    await contextsRepo.create({
      user_id: user.id,
      project_id: null,
      kind: "convention",
      title: "One package manager, everywhere",
      body: "Pick one and stick to it; lockfile churn from a stray install costs real time. An example of a convention worth writing down once.",
    });
  }

  if (!(await contextsRepo.listByProject(user.id, todox.id)).length) {
    await contextsRepo.create({
      user_id: user.id,
      project_id: todox.id,
      kind: "decision",
      title: "MCP is the write path, the web UI is the reader",
      body: "Every dead todo app died of dual entry. The agent authors most of the log during normal work; the human curates. If the human has to type it twice, the product is already dead.",
    });
    await contextsRepo.create({
      user_id: user.id,
      project_id: todox.id,
      kind: "gotcha",
      title: "The HTTP driver rejects multi-statement SQL",
      body: "Neon's serverless driver refuses more than one command per request, so the schema is applied statement by statement.",
    });
  }

  if (!(await tasksRepo.listByProject(todox.id, "all")).length) {
    const t1 = await taskService.create({
      project_id: todox.id,
      title: "Decide what stops this becoming another dead todo app",
      body: "Not a feature list. The one mechanic that makes a developer still use it in week three.",
      status: "doing",
      priority: 1,
    });
    await taskService.addEntry({
      task_id: t1.id,
      kind: "decision",
      body: "The unit is not a todo, it is a work log: decisions, dead ends, open questions, handoff. An issue tracker is human-to-human; this is agent-to-agent with a human reading over its shoulder.",
    });
    await taskService.addEntry({
      task_id: t1.id,
      kind: "dead_end",
      body: "Mirroring GitHub Issues and layering context on top. Rejected: the issue model is too thin to hang a log on, and it drags in auth, rate limits and webhooks before the idea is even proven.",
    });
    await taskService.addEntry({
      task_id: t1.id,
      kind: "handoff",
      body: "Settled: own task model, no GitHub. Next up is proving the loop end to end — an agent calls get_context, works, and writes a handoff that a fresh session can actually resume from.",
    });
    await refsRepo.link({
      task_id: t1.id,
      paths: [
        {
          path: resolve(REPO, "lib/services/briefing.ts"),
          note: "briefing() is the whole thesis in one function",
        },
        {
          path: resolve(REPO, "mcp/server.ts"),
          note: "tool surface the agent sees",
        },
      ],
    });

    const t2 = await taskService.create({
      project_id: todox.id,
      title: "Staleness: warn when a note describes code that has moved on",
      body: "Files are hashed at link time. get_context flags changed/missing. Open question is whether re-hash should be automatic on task close.",
      status: "todo",
      priority: 1,
    });
    await taskService.addEntry({
      task_id: t2.id,
      kind: "note",
      body: "Hash-per-file is the cheap version. The honest version is per-symbol or per-commit-range, but that needs a git integration.",
    });

    await taskService.create({
      project_id: todox.id,
      title: "Keyboard-first navigation (j/k, g p, enter)",
      body: "Dev tool. Mouse-only browsing will feel wrong within a day.",
      status: "todo",
      priority: 3,
    });

    await taskService.create({
      project_id: todox.id,
      title: "Move from SQLite to Postgres",
      status: "done",
      priority: 2,
    });
  }

  // Shows the shape that matters most: a blocked task carrying a dead end, so
  // the next session knows which wall has already been walked into.
  if (!(await tasksRepo.listByProject(example.id, "all")).length) {
    const g = await taskService.create({
      project_id: example.id,
      title: "Checkout times out under load, but only on the first request",
      body: "Cold start, roughly one request in fifty. Needs a different approach, not another timeout bump.",
      status: "blocked",
      priority: 1,
    });
    await taskService.addEntry({
      task_id: g.id,
      kind: "dead_end",
      body: "Raising the client timeout to 30s — hides it in staging and does nothing under real load, because the connection is already gone by then. Tried twice across two sessions; do not try a third.",
    });
    await taskService.addEntry({
      task_id: g.id,
      kind: "handoff",
      body: "Next thing to try is a warm connection on boot rather than lazily on first use. The timeout is a symptom.",
    });
  }

  const slugs = (await projectsRepo.list(user.id)).map((p) => p.slug).join(", ");
  console.log(`seeded for @${DEMO.username} (password: ${DEMO.password}): ${slugs}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
