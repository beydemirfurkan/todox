/**
 * End-to-end check of the agent path, run twice: once against the hosted
 * endpoint at /api/mcp, which is how almost everyone connects, and once
 * against the local stdio process, which is the mode that can hash files.
 *
 * Running the same assertions through both transports is what keeps
 * `mcp/tools.ts` honest as the single definition of the agent surface — a tool
 * that only works one way in fails here.
 *
 * Also proves the two things accounts have to guarantee: no token, no access;
 * wrong account, no access.
 *
 * Needs the web server running. Point TODOX_URL at it if it is not on :3000.
 */
import "./env";

import { localDatabaseOnly } from "./local-only";

localDatabaseOnly("smoke:mcp");

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as contextsRepo from "../lib/repositories/contexts";
import * as entriesRepo from "../lib/repositories/entries";
import * as projectsRepo from "../lib/repositories/projects";
import * as tasksRepo from "../lib/repositories/tasks";
import * as usersRepo from "../lib/repositories/users";
import { createApiToken } from "../lib/services/auth";
import { hashPassword } from "../lib/util/password";
import { normalisePath } from "../lib/util/paths";
import { SERVER_INFO } from "../mcp/tools";

/** A throwaway repo the agent has never heard of, to prove auto-registration. */
const SCRATCH = join(tmpdir(), "todox-smoke-repo");
/** A second one, because one account holds many and they must not mix. */
const OTHER = join(tmpdir(), "todox-smoke-other");
/**
 * The same repository as SCRATCH, as it looks on the developer's other computer:
 * a different absolute path, the same git remote. This is the fixture that
 * proves one repo stays one project across machines.
 */
const ELSEWHERE = join(tmpdir(), "todox-smoke-repo-elsewhere");
/** Both checkouts answer with this, which is what ties them together. */
const REMOTE = "git@github.com:todox-smoke/repo.git";
const URL_BASE = process.env.TODOX_URL ?? "http://localhost:3000";
const MODEL = "claude-opus-5";

/** What a remote agent is expected to compute for itself. */
const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

async function ensureUser(username: string, name: string) {
  return (
    (await usersRepo.byUsername(username)) ??
    usersRepo.create({
      username,
      email: `${username}@todox.local`,
      name,
      password_hash: await hashPassword("smoke-password"),
    })
  );
}

type Mode = { label: string; local: boolean; transport(token: string): Transport };

const MODES: Mode[] = [
  {
    label: "remote (/api/mcp)",
    local: false,
    transport: (token) =>
      new StreamableHTTPClientTransport(new URL("/api/mcp", URL_BASE), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
  },
  {
    label: "local (stdio)",
    local: true,
    transport: (token) =>
      new StdioClientTransport({
        command: "pnpm",
        args: ["exec", "tsx", join(__dirname, "..", "mcp", "server.ts")],
        // The client name reaches this process through its environment, the
        // way a real agent launcher passes it. Over HTTP the same fact arrives
        // in the `initialize` handshake instead — one fact, two channels, which
        // is the difference the assertion below exists to catch.
        env: {
          ...process.env,
          TODOX_TOKEN: token,
          TODOX_URL: URL_BASE,
          TODOX_CLIENT_NAME: CLIENT_NAME,
          TODOX_CLIENT_VERSION: "smoke",
        } as Record<string, string>,
      }),
  },
];

/**
 * What the smoke announces itself as, on both ways in.
 *
 * It has to map to a real client family or `notesFor` has nothing specific to
 * say, and it has to be recognisable as the smoke in a database somebody is
 * looking at. Over HTTP it travels in the `initialize` handshake; on stdio it
 * travels in the environment. One name, two channels — which is exactly the
 * difference worth asserting.
 */
const CLIENT_NAME = "claude-code-smoke";

/** The same run through whichever way in it was handed. */
async function runSuite(mode: Mode, token: string) {
  console.log(`\n=========== ${mode.label} ===========`);

  const client = new Client({ name: CLIENT_NAME, version: "0" });
  await client.connect(mode.transport(token));

  // The handshake, not the constant: this is the one fact a client learns
  // before it learns anything else, and both ways in have to answer it the
  // same. It said "1.0.0" on both for as long as there was no release to
  // disagree with, and the first tag is what made that a lie.
  const announced = client.getServerVersion();
  if (announced?.name !== SERVER_INFO.name || announced?.version !== SERVER_INFO.version) {
    throw new Error(
      `initialize announced ${announced?.name}@${announced?.version}, expected ${SERVER_INFO.name}@${SERVER_INFO.version}`,
    );
  }
  console.log("announced:", `${announced.name}@${announced.version}`);

  const tools = await client.listTools();
  console.log("tools:", tools.tools.map((t) => t.name).join(", "));

  // Remote has no disk, so the agent is the only one who can supply these and
  // the schema must say so. Locally the process fills them in and hiding them
  // is what stops a model inventing a path it cannot see.
  const ctx = tools.tools.find((t) => t.name === "get_context");
  const props = Object.keys(
    (ctx?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {},
  );
  const shows = props.includes("repo_root");
  if (shows === mode.local) {
    throw new Error(
      `repo_root should be ${mode.local ? "hidden locally" : "offered remotely"}, but properties were: ${props.join(", ")}`,
    );
  }
  console.log("repo_root advertised:", shows);

  // Same rule for the remote: this side reads it when it has a disk, and asks
  // the agent when it does not.
  const showsUrl = props.includes("repo_url");
  if (showsUrl === mode.local) {
    throw new Error(
      `repo_url should be ${mode.local ? "hidden locally" : "offered remotely"}, but properties were: ${props.join(", ")}`,
    );
  }
  console.log("repo_url advertised:", showsUrl);

  const text = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return (r.content as { text: string }[])[0].text;
  };

  console.log("\n--- the agent starts with only a working directory ---");
  const fresh = JSON.parse(
    await text("create_task", {
      cwd: SCRATCH,
      title: "SMOKE: captured without being told the project",
      body: "The agent only knew its working directory.",
      model: MODEL,
      // Remote cannot walk up looking for a .git, nor read one, so the agent
      // says where it is and what it is. Locally both are filled in for it.
      ...(mode.local ? {} : { repo_root: SCRATCH, repo_url: REMOTE }),
    }),
  );
  console.log("project_created:", fresh.project_created, "| slug:", fresh.project.slug);
  const taskId = fresh.task.id;

  console.log("\n--- a nested file path resolves to the same project ---");
  const again = JSON.parse(
    await text("create_task", {
      cwd: `${SCRATCH}/src/deep/file.ts`,
      title: "SMOKE: second capture",
      model: MODEL,
      ...(mode.local ? {} : { repo_root: SCRATCH }),
    }),
  );
  console.log("project_created:", again.project_created, "| slug:", again.project.slug);
  if (again.project.slug !== fresh.project.slug)
    throw new Error("a nested path should resolve to the project it sits in");

  /**
   * The bug this whole change exists for: one repository, two machines, one
   * project. The path is a different string on the other computer and the
   * remote is not, so the remote is what has to carry the identity.
   */
  console.log("\n--- the same repo, opened on a second machine ---");
  const elsewhere = JSON.parse(
    await text("get_context", {
      cwd: ELSEWHERE,
      ...(mode.local ? {} : { repo_root: ELSEWHERE, repo_url: REMOTE }),
    }),
  );
  console.log(
    "project_created:", elsewhere.project_created, "| slug:", elsewhere.project.slug,
  );
  if (elsewhere.project.slug !== fresh.project.slug)
    throw new Error(
      `a second checkout registered as "${elsewhere.project.slug}" instead of joining "${fresh.project.slug}"`,
    );
  if (elsewhere.project_created)
    throw new Error("the second machine created a project rather than finding the existing one");

  /**
   * And the path was remembered -- asserted with `repo_url` deliberately
   * omitted, so it cannot pass for the wrong reason. Without the stored path
   * this only works while the agent keeps sending the remote on every call,
   * and one that forgets once is back to a duplicate.
   */
  console.log("\n--- and the second machine's path stuck, without the remote ---");
  const remembered = JSON.parse(
    await text("get_context", {
      cwd: `${ELSEWHERE}/src/deep/file.ts`,
      ...(mode.local ? {} : { repo_root: ELSEWHERE }),
    }),
  );
  if (remembered.project.slug !== fresh.project.slug)
    throw new Error("the second machine's path was not remembered");

  /** The point of all of it: one memory, not two halves. */
  if (!JSON.stringify(remembered.open_tasks).includes("captured without being told"))
    throw new Error("the other machine's tasks are not visible from this one");

  console.log("\n--- write path ---");
  await text("update_task", { task_id: taskId, status: "doing", model: MODEL });
  await text("log_entry", {
    task_id: taskId,
    kind: "dead_end",
    body: "SMOKE: tried X, it did not work because Y.",
    model: MODEL,
  });
  await text("update_task", { task_id: taskId, status: "done", model: MODEL });
  const full = JSON.parse(await text("get_task", { task_id: taskId }));
  console.log("status:", full.status, "| entries:", full.entries.length);

  console.log("\n--- linked files ---");
  const marker = join(SCRATCH, "package.json");
  await text("link_files", {
    task_id: taskId,
    paths: [
      {
        path: marker,
        note: "SMOKE",
        // Locally the process hashes it and the schema does not even offer the
        // field. Remotely the agent is the one with the file, which is the
        // whole reason staleness can work over HTTP at all.
        ...(mode.local ? {} : { hash: sha256(marker) }),
      },
    ],
  });
  const linked = JSON.parse(await text("get_task", { task_id: taskId }));
  const refId = linked.files[0].id;

  // The other end of the same link. `refs.path` was write-only until now:
  // every read went in by task id, so the one question a coding agent actually
  // asks -- what do we already know about the file I am about to edit -- had
  // no answer over data todox had all along.
  console.log("\n--- and the file can be asked what is known about it ---");
  const known = JSON.parse(await text("get_file_context", { path: marker, cwd: SCRATCH }));
  if (!known.tasks.some((t: { id: number }) => t.id === taskId))
    throw new Error(`get_file_context did not find task #${taskId} on ${marker}`);
  if (known.path !== "package.json")
    throw new Error(`expected the repo-relative path, got ${JSON.stringify(known.path)}`);
  // The claim that makes this survive a second computer: the same file asked
  // for by the name it has *inside* the repo, with no absolute path at all.
  const byRelative = JSON.parse(
    await text("get_file_context", { path: "package.json", cwd: SCRATCH }),
  );
  if (!byRelative.tasks.some((t: { id: number }) => t.id === taskId))
    throw new Error("a relative path found nothing, so a second machine would not either");
  console.log(
    `by absolute and by relative: task #${taskId}, dead ends: ${known.tasks[0].dead_ends.length}`,
  );

  // A standing rule about a file, findable from the file. The column and its
  // unique index existed; no surface could write one.
  const fileNote = JSON.parse(
    await text("add_context", {
      cwd: SCRATCH,
      kind: "convention",
      title: "SMOKE-FILE-RULE",
      body: "Whatever this file is for, this is the rule about it.",
      ...(mode.local ? {} : { repo_root: SCRATCH }),
    }),
  );
  await text("link_files", {
    context_id: fileNote.id,
    paths: [{ path: marker, ...(mode.local ? {} : { hash: sha256(marker) }) }],
  });
  const withNote = JSON.parse(await text("get_file_context", { path: marker, cwd: SCRATCH }));
  const rule = withNote.notes.find((n: { title: string }) => n.title === "SMOKE-FILE-RULE");
  if (!rule) throw new Error("a note linked to the file did not come back from the file");
  if (!rule.body.includes("this is the rule about it"))
    throw new Error("the note came back without its body");
  console.log("note reached the file:", rule.title);
  await text("delete_context", { context_id: fileNote.id });
  const status = linked.files[0].status;

  // Locally the process reads the file on the way through, so the answer is
  // already there. Remotely the server has been told a hash but nobody has
  // looked since -- and "not checked" is what it must say until somebody has.
  const first = mode.local ? "fresh" : "unknown";
  if (status !== first)
    throw new Error(`linked file should read ${first} in ${mode.label}, got ${status}`);
  console.log("straight after linking:", status);

  if (!mode.local) {
    // The remote half of the loop, which had no tool at all: the agent hashes
    // what it was handed and reports back. Without it every hosted ref stayed
    // "unknown" for ever and the staleness feature never ran.
    await text("report_file_hashes", { refs: [{ id: refId, hash: sha256(marker) }] });
    const seen = JSON.parse(await text("get_task", { task_id: taskId }));
    if (seen.files[0].status !== "fresh")
      throw new Error(`after reporting, remote should read fresh, got ${seen.files[0].status}`);
    console.log("after the agent reported:", seen.files[0].status);
  }

  console.log("\n--- and an edit is caught ---");
  writeFileSync(marker, '{"name":"smoke-repo","edited":true}\n');
  if (!mode.local)
    await text("report_file_hashes", { refs: [{ id: refId, hash: sha256(marker) }] });

  const rechecked = JSON.parse(await text("get_task", { task_id: taskId }));
  const after = rechecked.files[0].status;
  if (after !== "changed")
    throw new Error(`an edited file should read changed in ${mode.label}, got ${after}`);
  console.log("after editing the file:", after);

  // A stale warning nothing can clear is worse than no warning: it returns in
  // every briefing from here on, and a session learns to read past it. Only
  // the agent can clear this one -- the server has no copy of the file, so all
  // it can ever know is that two hashes differ, never that the difference is
  // fine. Checked here, while the file is still edited: the line below puts it
  // back, and a warning that cleared itself would prove nothing.
  console.log("\n--- and the agent can say it has read the change ---");
  const accepted = JSON.parse(await text("accept_file_change", { ref_id: refId }));
  if (!accepted.accepted)
    throw new Error(`accept_file_change refused: ${accepted.reason ?? "no reason given"}`);

  const settled = JSON.parse(await text("get_task", { task_id: taskId })).files[0].status;
  if (settled === "changed") throw new Error("the warning survived being accepted");
  console.log("after accepting:", settled);

  await text("unlink_file", { ref_id: refId });
  const unlinked = JSON.parse(await text("get_task", { task_id: taskId })).files as {
    id: number;
  }[];
  if (unlinked.some((f) => f.id === refId))
    throw new Error("an unlinked file is still attached to the task");
  console.log("and a link that stopped meaning anything can be dropped");

  writeFileSync(marker, '{"name":"smoke-repo"}\n');

  /**
   * One account, two repositories.
   *
   * Everything above proves the log survives a session. This proves it lands
   * in the right place: a second project resolved from a second `cwd`, a dead
   * end that stays in the project it belongs to, and an account-wide note that
   * reaches both. Cross-account isolation was covered; this pair was not, and
   * the two failure modes are not the same shape. A dead end bleeding into
   * another repo's briefing is precisely the thing that would make the log not
   * worth reading.
   *
   * Raised by alkhunizan in #1, who wanted the "memory across every repo, not
   * one" claim to be something a stranger could check rather than believe.
   */
  console.log("\n--- one account, two repos, no bleeding ---");
  await text("create_task", {
    cwd: OTHER,
    title: "SMOKE: work in the second repo",
    model: MODEL,
    ...(mode.local ? {} : { repo_root: OTHER }),
  });

  // A task that is still open, because a briefing carries open work: the
  // dead end above went on a task this suite had already closed, so the
  // assertion failed for a reason that had nothing to do with isolation.
  const openA = JSON.parse(
    await text("create_task", {
      cwd: SCRATCH,
      title: "SMOKE: still open in the first repo",
      model: MODEL,
      ...(mode.local ? {} : { repo_root: SCRATCH }),
    }),
  ).task.id;
  // The id is kept because the question-closing check below needs an entry that
  // is *not* a question, to prove the field refuses one.
  const openADeadEnd = JSON.parse(
    await text("log_entry", {
      task_id: openA,
      kind: "dead_end",
      body: "SMOKE-A-ONLY: this belongs to the first repo and must not surface in the second.",
      model: MODEL,
    }),
  ).id;
  // A question is the only kind that can be open, and until now it was the only
  // kind that could never stop being open. Two things have to hold: the id has
  // to reach the agent in the first place (the briefing used to hand back bare
  // strings, so there was nothing to point at), and answering it has to take it
  // out of the briefing without taking it out of the log.
  console.log("\n--- a question closes, and only by being answered ---");
  await text("log_entry", {
    task_id: openA,
    kind: "question",
    body: "SMOKE-QUESTION: which timezone should the report window use?",
    model: MODEL,
  });

  const withQuestion = JSON.parse(
    await text("get_context", { cwd: SCRATCH, ...(mode.local ? {} : { repo_root: SCRATCH }) }),
  );
  const askedOn = withQuestion.open_tasks.find((t: { id: number }) => t.id === openA);
  const question = askedOn?.open_questions?.find((q: { body: string }) =>
    q.body.includes("SMOKE-QUESTION"),
  );
  if (!question) throw new Error("the question never reached the briefing");
  if (typeof question.id !== "number")
    throw new Error(`the briefing handed back a question with no id: ${JSON.stringify(question)}`);
  console.log("asked, and nameable: #" + question.id);

  // Two refusals. `text` hands a tool error back as its text rather than
  // throwing, which is how the agent sees it too -- so this reads the answer.
  //
  // The id that does not exist and the id that belongs elsewhere must be
  // refused in the *same* words: a message that distinguished them would tell a
  // caller which numbers are real on somebody else's task.
  const refused = async (why: string, answers_entry_id: number, expected: RegExp) => {
    const answer = await text("log_entry", {
      task_id: openA,
      kind: "decision",
      body: `SMOKE-REJECT: ${why}`,
      answers_entry_id,
      model: MODEL,
    });
    if (!expected.test(answer)) throw new Error(`log_entry accepted ${why}: ${answer}`);
    console.log(`refused ${why}`);
  };

  await refused("an id on no task of ours", 999_999, /not on task/);
  // The answer itself is a decision, so pointing at it is the wrong-kind case.
  await refused("an entry that is not a question", openADeadEnd, /only a question/);

  await text("log_entry", {
    task_id: openA,
    kind: "decision",
    body: "SMOKE-ANSWER: UTC, and the report says so when it cannot determine a zone.",
    answers_entry_id: question.id,
    model: MODEL,
  });

  const answered = JSON.parse(
    await text("get_context", { cwd: SCRATCH, ...(mode.local ? {} : { repo_root: SCRATCH }) }),
  );
  const closedOn = answered.open_tasks.find((t: { id: number }) => t.id === openA);
  if (closedOn?.open_questions?.some((q: { body: string }) => q.body.includes("SMOKE-QUESTION")))
    throw new Error("an answered question is still open in the briefing");
  // Closed, not deleted: the log is the product and the pair is the point.
  const whole = JSON.parse(await text("get_task", { task_id: openA }));
  const kinds = whole.entries.filter((e: { body: string }) =>
    e.body.includes("SMOKE-QUESTION") || e.body.includes("SMOKE-ANSWER"),
  );
  if (kinds.length !== 2)
    throw new Error(`the question and its answer should both survive; found ${kinds.length}`);
  console.log("answered: out of the briefing, still in the log");

  await text("add_context", {
    kind: "preference",
    title: "SMOKE-EVERYWHERE",
    body: "Account-wide: no project passed, so both briefings should carry it.",
  });

  const a = JSON.parse(await text("get_context", { cwd: SCRATCH }));
  const b = JSON.parse(await text("get_context", { cwd: OTHER }));

  // The briefing says which client it is talking to, and hands it advice for
  // that client. This was dead on stdio: that side was given the bearer token
  // and told to look the answer up in Postgres, which it cannot reach, so the
  // lookup threw on every call and the notes silently never appeared. The notes
  // exist because connecting a server is not the same as using it, so losing
  // them locally was losing the fix. Each side now answers from what it has —
  // the row over HTTP, the launching environment on stdio — and this asserts
  // the answer rather than the mechanism, so it holds for both.
  console.log("\n--- the briefing knows which client it is talking to ---");
  if (a.client !== CLIENT_NAME)
    throw new Error(
      `briefing reported client ${JSON.stringify(a.client)}, not ${JSON.stringify(CLIENT_NAME)}`,
    );
  if (!Array.isArray(a.notes) || a.notes.length === 0)
    throw new Error("briefing carried no client-specific notes");
  if (!a.notes.join("\n").includes("CLAUDE.md"))
    throw new Error(`notes did not mention the memory file: ${JSON.stringify(a.notes)}`);
  console.log(`client: ${a.client} · ${a.notes.length} note(s)`);

  if (a.project.slug === b.project.slug)
    throw new Error(`two working directories resolved to one project: ${a.project.slug}`);

  // `{ id, body }` rather than a bare string since the briefing started naming
  // what it hands back, so that an agent can answer a question it was shown.
  const deadEnds = (brief: { open_tasks: { dead_ends: { body: string }[] }[] }) =>
    brief.open_tasks.flatMap((t) => t.dead_ends.map((d) => d.body)).join("\n");
  if (!deadEnds(a).includes("SMOKE-A-ONLY"))
    throw new Error("the first project lost its own dead end");
  if (deadEnds(b).includes("SMOKE-A-ONLY"))
    throw new Error("a dead end from one project reached another project's briefing");

  const globals = (brief: { global_context: { title: string }[] }) =>
    brief.global_context.map((c) => c.title);
  for (const [label, brief] of [
    ["first", a],
    ["second", b],
  ] as const)
    if (!globals(brief).includes("SMOKE-EVERYWHERE"))
      throw new Error(`the account-wide note is missing from the ${label} briefing`);

  // Staleness belongs to the project holding the file, not to the account.
  if (b.stale_refs.length)
    throw new Error(`the second project inherited a stale warning: ${b.stale_refs.join(", ")}`);

  console.log(
    `projects: ${a.project.slug} / ${b.project.slug} · dead end stayed in ${a.project.slug} ·`,
    "account-wide note reached both · stale warning did not travel",
  );

  // The claim this product makes is that the log is worth trusting, and a log
  // that can only be added to stops being worth trusting the moment it is
  // wrong. So: write a note, correct it, and check the briefing the next
  // session gets carries the correction rather than both versions.
  console.log("\n--- a note can be corrected, and the briefing shows the correction ---");
  const note = JSON.parse(
    await text("add_context", {
      cwd: SCRATCH,
      kind: "gotcha",
      title: "SMOKE-CORRECTION",
      body: "WRONG: the first thing this session believed.",
      ...(mode.local ? {} : { repo_root: SCRATCH }),
    }),
  );

  await text("update_context", {
    context_id: note.id,
    body: "RIGHT: what turned out to be true.",
  });

  const corrected = JSON.parse(await text("get_context", { cwd: SCRATCH }));
  const noteIn = (brief: { project_context: { title: string; body: string }[] }) =>
    brief.project_context.find((c) => c.title === "SMOKE-CORRECTION");

  if (noteIn(corrected)?.body.includes("WRONG"))
    throw new Error("the briefing still carries the note the session corrected");
  if (!noteIn(corrected)?.body.includes("RIGHT"))
    throw new Error("the correction never reached the briefing");
  console.log("corrected in place:", noteIn(corrected)?.body);

  // The briefing caps note bodies, so a note it did not pay for comes back as
  // a title and an id with `body: null`. That is only honest if the id can be
  // spent -- and `get_context_note` is the whole reason the cap is a budget
  // rather than a loss. Read this one back through it and check the body is
  // the corrected one, not the original.
  const wholeNote = JSON.parse(await text("get_context_note", { context_id: note.id }));
  if (wholeNote.id !== note.id)
    throw new Error(`get_context_note returned #${wholeNote.id}, asked for #${note.id}`);
  if (!wholeNote.body?.includes("RIGHT"))
    throw new Error(`get_context_note gave back ${JSON.stringify(wholeNote.body)}`);
  // The briefing hands out four fields; this hands out the row, timestamps
  // included -- that is the difference worth having between them.
  if (!wholeNote.updated_at) throw new Error("get_context_note dropped the timestamps");
  console.log("read back in full:", wholeNote.title, "· updated_at present");

  // A focus reorders which notes keep their bodies. Two things have to hold and
  // neither is visible from the payload alone: the ranking actually ran, and it
  // did not lose a note. `context_ranked_by` reports the first; comparing the
  // two title sets reports the second, which is the property that lets the
  // instructions tell an agent there is no cost to sending one.
  console.log("\n--- and a focus reorders the notes without dropping any ---");
  const ranked = JSON.parse(
    await text("get_context", {
      cwd: SCRATCH,
      focus: "a note this session corrected in place",
      ...(mode.local ? {} : { repo_root: SCRATCH }),
    }),
  );
  if (ranked.context_ranked_by !== "focus")
    throw new Error(`focus was ignored: context_ranked_by=${ranked.context_ranked_by}`);
  if (corrected.context_ranked_by !== "recency")
    throw new Error("a briefing with no focus claimed to be ranked by one");
  const titles = (b: { project_context: { title: string }[] }) =>
    b.project_context.map((c) => c.title).sort().join("|");
  if (titles(ranked) !== titles(corrected))
    throw new Error("ranking by focus changed which notes came back, not just their order");
  if (!ranked.project_context.some((c: { title: string }) => c.title === "SMOKE-CORRECTION"))
    throw new Error("the note the focus described is not in the briefing at all");
  console.log("ranked_by:", ranked.context_ranked_by, "· same notes, reordered");

  // `search` was in none of the four smoke suites, which is how it kept a
  // description promising full-text over three ILIKE scans. Now that it parses
  // the query, the assertion worth making is the one that used to fail: a
  // question, in words, finding the note that answers it.
  // Filters narrow; they must not quietly do nothing. A filter that is ignored
  // searches everything and looks exactly like one that worked, so each of
  // these asserts a hit that should survive *and* one that should not.
  console.log("\n--- and the search can be narrowed ---");
  const hits = async (args: Record<string, unknown>) =>
    JSON.parse(await text("search", args)) as {
      type: string;
      title: string;
      project_slug: string | null;
    }[];

  const onlyNotes = await hits({ query: "SMOKE", kinds: ["preference"] });
  if (!onlyNotes.length) throw new Error("kinds filtered everything away");
  if (onlyNotes.some((h) => h.type !== "context"))
    throw new Error(`a kind filter let a ${onlyNotes.find((h) => h.type !== "context")?.type} through`);

  // Tasks have no kind, so any kind filter must exclude them -- and without one
  // they have to come back, or the assertion above proves nothing.
  const everything = await hits({ query: "SMOKE" });
  if (!everything.some((h) => h.type === "task"))
    throw new Error("an unfiltered search returned no tasks, so the filter test is vacuous");
  console.log(`kinds: ${onlyNotes.length} note(s), unfiltered: ${everything.length} hit(s)`);

  // The account holds two projects here, which is what makes this test mean
  // something: the second one's records have to be in the unfiltered answer and
  // out of the filtered one. Asserting only that the filter "returned fewer"
  // would pass on a filter that dropped rows at random.
  if (!everything.some((h) => h.project_slug === b.project.slug))
    throw new Error("the other project is not in the unfiltered answer, so nothing is being tested");

  const scoped = await hits({ query: "SMOKE", project: a.project.slug });
  if (!scoped.length) throw new Error("a project filter returned nothing at all");
  const strays = scoped.filter(
    // null is an account-wide note, which survives on purpose: a rule that
    // applies to every project applies to the one being asked about.
    (h) => h.project_slug !== null && h.project_slug !== a.project.slug,
  );
  if (strays.length)
    throw new Error(`the project filter let ${strays[0].project_slug} through`);
  console.log(`project ${a.project.slug}: ${scoped.length} of ${everything.length}`);

  console.log("\n--- and a question, in words, finds the note ---");
  const found = JSON.parse(
    await text("search", { query: "what did this session turn out to be right about?" }),
  );
  const hitIds = (found as { type: string; id: number }[]).map((h) => `${h.type}#${h.id}`);
  if (!hitIds.includes(`context#${note.id}`))
    throw new Error(`a natural-language search missed the note; got ${hitIds.join(", ") || "nothing"}`);

  // And the snippet points at the match rather than at the top of the body,
  // which is what makes a hit readable without a second call.
  const hit = (found as { id: number; type: string; snippet: string }[]).find(
    (h) => h.type === "context" && h.id === note.id,
  )!;
  if (!/right/i.test(hit.snippet))
    throw new Error(`the snippet does not contain the match: ${JSON.stringify(hit.snippet)}`);
  console.log("found by question, snippet carries the match");


  // An entry that was wrong when it was written, rather than overtaken.
  const slip = JSON.parse(
    await text("log_entry", {
      task_id: openA,
      kind: "decision",
      body: "SMOKE-SLIP: recorded against the wrong task.",
      model: MODEL,
    }),
  );
  await text("delete_entry", { entry_id: slip.id });

  const afterDelete = JSON.parse(await text("get_task", { task_id: openA }));
  if (JSON.stringify(afterDelete.entries).includes("SMOKE-SLIP"))
    throw new Error("a deleted entry is still in the task's log");

  await text("delete_context", { context_id: note.id });
  const afterRemoval = JSON.parse(await text("get_context", { cwd: SCRATCH }));
  if (noteIn(afterRemoval))
    throw new Error("a deleted note is still in the briefing");
  console.log("entry and note both removed, and gone from what the next session reads");

  console.log("\n--- report sees it ---");
  const md = await text("activity_report", {
    period: "today",
    format: "markdown",
    ...(mode.local ? {} : { tz: "Europe/Istanbul" }),
  });
  console.log(md.split("\n").slice(0, 5).join("\n"));

  await client.close();
}

async function main() {
  if (!(await fetch(URL_BASE).catch(() => null))) {
    console.error(
      `todox is not answering at ${URL_BASE}. Start it (pnpm dev) or set TODOX_URL.`,
    );
    process.exit(1);
  }

  mkdirSync(join(SCRATCH, "src", "deep"), { recursive: true });
  writeFileSync(join(SCRATCH, "package.json"), '{"name":"smoke-repo"}\n');
  mkdirSync(OTHER, { recursive: true });
  writeFileSync(join(OTHER, "package.json"), '{"name":"smoke-other"}\n');
  mkdirSync(join(ELSEWHERE, "src", "deep"), { recursive: true });
  writeFileSync(join(ELSEWHERE, "package.json"), '{"name":"smoke-repo"}\n');

  // Real repositories with the same origin: the stdio server actually shells
  // out to git, so without this the local half of the cross-machine assertions
  // would pass by reporting no remote at all -- which is not the same thing.
  for (const dir of [SCRATCH, ELSEWHERE]) {
    spawnSync("git", ["-C", dir, "init", "-q"], { stdio: "ignore" });
    spawnSync("git", ["-C", dir, "remote", "add", "origin", REMOTE], { stdio: "ignore" });
  }

  const user = await ensureUser("smoke-agent", "Smoke");
  const { token } = await createApiToken(user.id, "mcp-smoke");

  // Before, as well as after. See `removeRows`: a run that fails leaves its
  // project behind, and the next one then seeds a second copy of everything and
  // fails in an assertion that has nothing to do with what broke. Rows only --
  // the directories above are this run's, not the last one's.
  await removeRows(user.id);

  for (const mode of MODES) await runSuite(mode, token);

  const rpc = (bearer: string | null, body: unknown) =>
    fetch(new URL("/api/rpc", URL_BASE), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    });

  // Compared normalised, because that is how it was stored: a root path
  // arriving from a Windows agent has its separators folded on the way in, so
  // `C:\…\todox-smoke-repo` is on file as `C:/…/todox-smoke-repo`. Comparing
  // the raw string found nothing here and everything on Linux, which is the
  // narrowest possible way for a suite to lie about what it covers.
  const scratch = normalisePath(SCRATCH);
  const project = (await projectsRepo.list(user.id, true)).find(
    (p) => p.root_path && normalisePath(p.root_path) === scratch,
  );
  if (!project) throw new Error(`the smoke project for ${scratch} was never registered`);

  const anyTask = (await tasksRepo.listByProject(project.id, "all"))[0];

  console.log("\n--- another account cannot touch this task ---");
  const intruder = await ensureUser("smoke-intruder", "Intruder");
  const intruderToken = (await createApiToken(intruder.id, "mcp-smoke")).token;
  const denied = await rpc(intruderToken, {
    method: "getTask",
    params: { task_id: anyTask.id },
  });
  const deniedBody = await denied.json();
  // This printed the status and moved on, which is not the same as checking it:
  // remove `assertTask` from `getTask` and the old version stayed green while
  // handing one account another's work. 404 rather than 403, because the answer
  // must not tell the caller that the id exists.
  if (denied.status !== 404)
    throw new Error(
      `getTask answered ${denied.status} to a foreign token, not 404: ${JSON.stringify(deniedBody)}`,
    );
  // And the status alone is not enough -- a body carrying the task next to a
  // 404 would still be the leak. Nothing of the owner's may come back.
  const leaked = JSON.stringify(deniedBody);
  if (leaked.includes(anyTask.title))
    throw new Error(`getTask refused with 404 and returned the task anyway: ${leaked}`);
  console.log(denied.status, deniedBody.error, "· nothing of the task came back");

  // The methods that remove somebody's work take an id and nothing else, and
  // the repository call underneath takes no account id at all -- `remove(id)`
  // deletes whatever it is handed. The assert above it is the only thing in
  // the way, so a foreign id has to come back 404 and the row has to survive.
  console.log("\n--- and cannot delete somebody else's note or entry ---");
  // Made here rather than reused from the suite: the suite ends by correcting
  // and then removing its own note, so by this point there is nothing of its
  // making left to defend, and an intruder refused access to a row that was
  // already gone would pass for the wrong reason.
  const victimNote = await contextsRepo.create({
    user_id: user.id,
    project_id: project.id,
    kind: "gotcha",
    title: "SMOKE-VICTIM",
    body: "Belongs to the owner. An intruder must not be able to remove it.",
  });
  // Reading is the same exposure as deleting: `contexts.byId` takes no account
  // id either, so `getContextNote` is one missing assert away from handing an
  // intruder the note it was told not to delete.
  console.log("\n--- and cannot read somebody else's note ---");
  const peek = await rpc(intruderToken, {
    method: "getContextNote",
    params: { context_id: victimNote!.id },
  });
  const peekBody = await peek.json();
  if (peek.status !== 404)
    throw new Error(`getContextNote answered ${peek.status} to a foreign token, not 404`);
  if (JSON.stringify(peekBody).includes("Belongs to the owner"))
    throw new Error("getContextNote refused with 404 and returned the note anyway");
  console.log(peek.status, peekBody.error, "· nothing of the note came back");

  const victimEntry = (await entriesRepo.listByTask(anyTask.id))[0];
  for (const [label, method, params, stillThere] of [
    [
      "delete_context",
      "deleteContext",
      { context_id: victimNote?.id },
      async () => Boolean(await contextsRepo.byId(victimNote!.id)),
    ],
    [
      "delete_entry",
      "deleteEntry",
      { entry_id: victimEntry?.id },
      async () => Boolean(await entriesRepo.byId(victimEntry!.id)),
    ],
  ] as const) {
    if (params[Object.keys(params)[0] as keyof typeof params] === undefined)
      throw new Error(`the suite never created anything for ${label} to defend`);
    const refused = await rpc(intruderToken, { method, params });
    const body = await refused.json();
    if (refused.status !== 404)
      throw new Error(`${label} answered ${refused.status}, not 404: ${body.error}`);
    if (!(await stillThere()))
      throw new Error(`${label} was refused and deleted the row anyway`);
    console.log(`${label}: ${refused.status} ${body.error} · row survived`);
  }

  console.log("\n--- an unauthenticated call is refused, on both surfaces ---");
  const anon = await rpc(null, { method: "listProjects" });
  const anonBody = await anon.json();
  // Printed and unchecked before this, on the one guarantee the header of this
  // file claims: no token, no access.
  if (anon.status !== 401)
    throw new Error(
      `/api/rpc answered ${anon.status} without a token, not 401: ${JSON.stringify(anonBody)}`,
    );
  if (anonBody.projects !== undefined)
    throw new Error("/api/rpc refused an anonymous call and listed projects anyway");
  console.log("/api/rpc:", anon.status, anonBody.error);

  const anonMcp = await fetch(new URL("/api/mcp", URL_BASE), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  // An HTML body here means the proxy redirected us to /login instead of
  // letting the endpoint answer -- the failure mode that reads as a broken
  // server rather than a refusal.
  const ct = anonMcp.headers.get("content-type") ?? "";
  if (!ct.includes("application/json"))
    throw new Error(`/api/mcp answered ${anonMcp.status} as ${ct}; is it in proxy.ts PUBLIC?`);
  console.log("/api/mcp:", anonMcp.status, (await anonMcp.json()).error?.message);

  await removeRows(user.id);
  removeDirs();

  console.log("\nOK (cleaned up)");
}

/**
 * Leave no trace in the database -- and run it before the suite as well as
 * after it.
 *
 * Only running it at the end is fine right up until a run fails, and then the
 * next one seeds on top of what was left: two notes with the same title, two of
 * every record a count is taken of. What that produces is not a clean failure
 * but a confusing one, in an assertion that has nothing to do with whatever
 * actually broke -- "a deleted note is still in the briefing", when what
 * happened is that there were two.
 *
 * Paths are compared normalised because that is how they were stored -- a
 * Windows agent's separators are folded on the way in. ELSEWHERE should never
 * become a project's `root_path` -- that is the whole point, it joins
 * SCRATCH's -- but it is listed anyway: a run that fails between the two leaves
 * the row behind, and the next one then matches it by remote and fails
 * somewhere far less obvious.
 */
async function removeRows(userId: number) {
  const ours = new Set([
    normalisePath(SCRATCH),
    normalisePath(OTHER),
    normalisePath(ELSEWHERE),
  ]);
  for (const p of await projectsRepo.list(userId, true)) {
    for (const t of await tasksRepo.listByProject(p.id, "all"))
      if (t.title.startsWith("SMOKE:")) await tasksRepo.remove(t.id);
    if (p.root_path && ours.has(normalisePath(p.root_path)))
      await projectsRepo.remove(userId, p.id);
  }
}

/**
 * The other half, and separate from it because only one of the two may run
 * before the suite: the rows are stale and have to go, while the directories
 * are the ones `main` has just built and git-initialised.
 */
function removeDirs() {
  for (const dir of [SCRATCH, OTHER, ELSEWHERE])
    rmSync(dir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
