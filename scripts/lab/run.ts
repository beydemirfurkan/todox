/**
 * Runs the personas' agent sessions, headless, and keeps everything they leave.
 *
 *   pnpm lab:run                      every persona, sessions 1-3
 *   pnpm lab:run mert                 one persona
 *   pnpm lab:run mert 2               one session
 *   pnpm lab:run --dry-run            print the commands, run nothing
 *   pnpm lab:run --repeat 2           the whole lab twice, from a fresh setup
 *                                     each time, into <run>/r1 and <run>/r2
 *   pnpm lab:run --habit              agents that have the habit `install:mcp`
 *                                     writes (run lab:setup --habit first, or
 *                                     let --repeat do it)
 *
 * Personas run side by side; one persona's sessions run in order, each in a
 * fresh process, so the only thing that carries from one to the next is what
 * the agent wrote into todox (and the code, which a developer would commit).
 * A session that already finished in this run directory is skipped, so a run
 * that died halfway resumes where it stopped.
 *
 * Output: ~/todox-lab/runs/<run>/<persona>-s<n>/ with the agent's own event
 * stream, its stderr, the diff, and a snapshot of the persona's todox state.
 */
import "../env";
import { localDatabaseOnly } from "../local-only";

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { all, disconnect } from "../../lib/db/client";
import {
  CLAUDE_MODEL,
  claudeConfig,
  openCodeHome,
  OPENCODE_MODELS,
  repoDir,
  RUNS,
  TSX,
} from "./paths";
import { PERSONAS, personaByKey, type Persona, type PersonaKey, type Session } from "./personas";

localDatabaseOnly("lab:run");

const SESSION_TIMEOUT_MS = 20 * 60_000;
const MAX_TURNS = "60";
const MAX_BUDGET_USD = "5";

const BASE_RUN_ID = process.env.TODOX_LAB_RUN ?? new Date().toISOString().slice(0, 10);
/** `<run>`, or `<run>/r<n>` inside a repeated lab. Set once per repetition. */
let RUN_ID = BASE_RUN_ID;
/**
 * Whether the agents run with the habit installed. Off, the lab measures the
 * worst case -- connected, never told to use it -- which is what v1 and v2
 * measured and stays the baseline.
 */
const HAS_HABIT = process.argv.includes("--habit");
export const runDir = (persona: PersonaKey, session: number) =>
  join(RUNS, RUN_ID, `${persona}-s${session}`);

export interface SessionMeta {
  persona: PersonaKey;
  session: number;
  agent: Session["agent"];
  model: string;
  project: string;
  prompt: string;
  startSha: string;
  startedAt: string;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  habit: boolean;
}

interface Command {
  bin: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * Claude Code with nothing of the developer's: project settings only (the lab
 * repo has none), so no user CLAUDE.md, hooks or plugins; only the lab MCP
 * config; and no auto-memory, which would be a second memory competing with
 * the one under test.
 */
function claudeCommand(persona: PersonaKey, prompt: string): Command {
  return {
    bin: "claude",
    args: [
      "-p",
      prompt,
      "--setting-sources",
      "project",
      "--settings",
      JSON.stringify({ autoMemoryEnabled: false }),
      "--strict-mcp-config",
      "--mcp-config",
      claudeConfig(persona),
      "--model",
      CLAUDE_MODEL,
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--max-turns",
      MAX_TURNS,
      "--max-budget-usd",
      MAX_BUDGET_USD,
    ],
    env: { ...process.env },
  };
}

/** OpenCode under a private XDG config home (see setup.ts) and its own server. */
function openCodeCommand(persona: PersonaKey, prompt: string, title: string): Command {
  return {
    bin: "opencode",
    args: [
      "run",
      "--standalone",
      "--format",
      "json",
      "--auto",
      "-m",
      OPENCODE_MODELS[persona],
      "--title",
      title,
      prompt,
    ],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: openCodeHome(persona),
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    },
  };
}

function commandFor(p: Persona, n: number, session: Session): Command {
  return session.agent === "claude"
    ? claudeCommand(p.key, session.prompt)
    : openCodeCommand(p.key, session.prompt, `lab ${p.key} s${n}`);
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** Runs one agent process to the end (or the timeout), streaming to files. */
function execute(command: Command, cwd: string, dir: string) {
  return new Promise<{ exitCode: number | null; timedOut: boolean }>((resolve) => {
    const child = spawn(command.bin, command.args, {
      cwd,
      // OpenCode takes its project from PWD, not from the process cwd: without
      // this it opened the todox checkout the runner was started from.
      env: { ...command.env, PWD: cwd },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, SESSION_TIMEOUT_MS);
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      writeFileSync(join(dir, "transcript.jsonl"), Buffer.concat(out));
      writeFileSync(join(dir, "stderr.txt"), Buffer.concat(err));
      resolve({ exitCode, timedOut });
    });
  });
}

/**
 * The diff of the whole session, untracked files included, then a commit in the
 * persona's name: a developer commits at the end of a day, and the next
 * session should start from a clean tree, not from yesterday's working copy.
 */
function recordAndCommit(p: Persona, n: number, cwd: string, startSha: string, dir: string): void {
  git(cwd, "add", "-A");
  writeFileSync(join(dir, "diff.patch"), git(cwd, "diff", "--cached", startSha));
  writeFileSync(join(dir, "diffstat.txt"), git(cwd, "diff", "--cached", "--stat", startSha));
  const dirty = git(cwd, "status", "--porcelain").trim() !== "";
  if (dirty)
    git(
      cwd,
      "-c",
      `user.name=${p.name}`,
      "-c",
      `user.email=${p.username}@lab.todox.local`,
      "commit",
      "-q",
      "-m",
      `Session ${n}`,
    );
}

/**
 * What the persona's todox holds after the session, read straight from the
 * lab database: every project they can see, its tasks, its log and its notes.
 * Content is fine here -- these are fake accounts in a local database -- but it
 * never touches tool_usage, which is not the lab's to read.
 */
async function snapshot(username: string) {
  const projects = await all<{ id: number; slug: string; name: string; owner: string; repo_url: string | null }>(
    `SELECT p.id, p.slug, p.name, owner.username AS owner, p.repo_url
       FROM projects p
       JOIN users owner ON owner.id = p.user_id
       JOIN users me ON lower(me.username) = lower(?)
      WHERE p.user_id = me.id
         OR p.id IN (SELECT project_id FROM project_memberships WHERE user_id = me.id)
      ORDER BY p.id`,
    [username],
  );
  const ids = projects.map((row) => row.id);
  if (ids.length === 0) return { projects, tasks: [], entries: [], contexts: [], events: [], observations: 0 };
  const tasks = await all(
    `SELECT id, project_id, title, status, priority, length(body) AS body_length, created_at, updated_at
       FROM tasks WHERE project_id = ANY(?) ORDER BY id`,
    [ids],
  );
  const entries = await all(
    `SELECT e.id, e.task_id, e.kind, e.author, e.model, e.created_at, e.answers_entry_id, e.body,
            u.username AS by_user
       FROM entries e JOIN tasks t ON t.id = e.task_id LEFT JOIN users u ON u.id = e.user_id
      WHERE t.project_id = ANY(?) ORDER BY e.id`,
    [ids],
  );
  const contexts = await all(
    `SELECT c.id, c.project_id, c.kind, c.title, c.body, c.created_at, u.username AS by_user
       FROM contexts c JOIN users u ON u.id = c.user_id
      WHERE c.project_id = ANY(?) OR (c.project_id IS NULL AND lower(u.username) = lower(?))
      ORDER BY c.id`,
    [ids, username],
  );
  const events = await all(
    `SELECT ev.task_id, ev.from_status, ev.to_status, ev.at, ev.actor, ev.model
       FROM task_events ev JOIN tasks t ON t.id = ev.task_id
      WHERE t.project_id = ANY(?) ORDER BY ev.id`,
    [ids],
  );
  const [{ count }] = await all<{ count: number }>(
    `SELECT count(*)::int AS count FROM observations WHERE project_id = ANY(?)`,
    [ids],
  );
  return { projects, tasks, entries, contexts, events, observations: count };
}

const isFinished = (persona: PersonaKey, n: number) => {
  const file = join(runDir(persona, n), "meta.json");
  if (!existsSync(file)) return false;
  const meta = JSON.parse(readFileSync(file, "utf8")) as SessionMeta;
  return meta.exitCode === 0 && !meta.timedOut;
};

async function runSession(p: Persona, n: number, isDryRun: boolean): Promise<void> {
  const session = p.sessions[n - 1];
  const cwd = repoDir(p.key, session.project);
  const command = commandFor(p, n, session);
  if (isDryRun) {
    console.log(`[${p.key} s${n}] (cd ${cwd} && ${command.bin} ${command.args.map((a) => JSON.stringify(a)).join(" ")})`);
    return;
  }
  if (isFinished(p.key, n)) {
    console.log(`[${p.key} s${n}] already done in ${RUN_ID}, skipped`);
    return;
  }
  const dir = runDir(p.key, n);
  mkdirSync(dir, { recursive: true });
  const startSha = git(cwd, "rev-parse", "HEAD").trim();
  const startedAt = new Date().toISOString();
  console.log(`[${p.key} s${n}] ${session.agent} in ${session.project}`);
  const { exitCode, timedOut } = await execute(command, cwd, dir);
  const durationMs = Date.now() - Date.parse(startedAt);
  recordAndCommit(p, n, cwd, startSha, dir);
  writeFileSync(join(dir, "state.json"), JSON.stringify(await snapshot(p.username), null, 2));
  const meta: SessionMeta = {
    persona: p.key,
    session: n,
    agent: session.agent,
    model: session.agent === "claude" ? CLAUDE_MODEL : OPENCODE_MODELS[p.key],
    project: session.project,
    prompt: session.prompt,
    startSha,
    startedAt,
    durationMs,
    exitCode,
    timedOut,
    habit: HAS_HABIT,
  };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  console.log(
    `[${p.key} s${n}] exit ${exitCode}${timedOut ? " (timed out)" : ""} after ${Math.round(durationMs / 1000)}s`,
  );
}

/** One resolver per persona and session, so `after` can wait on another persona. */
function barriers(personas: Persona[]) {
  const map = new Map<string, { promise: Promise<void>; resolve(): void }>();
  for (const p of personas)
    for (const n of [1, 2, 3]) {
      let resolve = () => {};
      const promise = new Promise<void>((r) => (resolve = r));
      map.set(`${p.key}:${n}`, { promise, resolve });
    }
  return map;
}

/** `--repeat N`, and the arguments that are left once it is taken out. */
function parseRepeat(argv: string[]): { repeat: number | undefined; rest: string[] } {
  const at = argv.indexOf("--repeat");
  if (at === -1) return { repeat: undefined, rest: argv };
  const repeat = Number(argv[at + 1]);
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat takes a whole number, 1 or more");
  return { repeat, rest: [...argv.slice(0, at), ...argv.slice(at + 2)] };
}

/**
 * A fresh lab before a repetition, unless that repetition has already begun:
 * a run that died halfway resumes where it stopped, and resetting under it
 * would wipe the todox state its next session is meant to read.
 */
function freshLabFor(personas: Persona[], isDryRun: boolean): void {
  const hasBegun = personas.some((p) => [1, 2, 3].some((n) => existsSync(join(runDir(p.key, n), "meta.json"))));
  if (hasBegun) {
    console.log(`[lab] ${RUN_ID} already begun, resuming without a reset`);
    return;
  }
  if (isDryRun) {
    console.log(`[lab] ${RUN_ID}: would run lab:setup --reset${HAS_HABIT ? " --habit" : ""}`);
    return;
  }
  const setupArgs = [join(import.meta.dirname, "setup.ts"), "--reset", ...(HAS_HABIT ? ["--habit"] : [])];
  console.log(`[lab] ${RUN_ID}: lab:setup ${setupArgs.slice(1).join(" ")}`);
  execFileSync(TSX, setupArgs, { stdio: "inherit" });
}

async function main(): Promise<void> {
  const { repeat, rest } = parseRepeat(process.argv.slice(2));
  const positional = rest.filter((arg) => !arg.startsWith("--"));
  const isDryRun = rest.includes("--dry-run");
  const only = positional[0] && positional[0] !== "all" ? personaByKey(positional[0]) : undefined;
  if (positional[0] && positional[0] !== "all" && !only) throw new Error(`no persona "${positional[0]}"`);
  const sessions = positional[1] ? [Number(positional[1])] : [1, 2, 3];
  const personas = only ? [only] : PERSONAS;
  if (repeat !== undefined && (only || positional[1]))
    throw new Error("--repeat runs the whole lab; it does not take a persona or a session");

  if (repeat === undefined) return runAll(personas, sessions, isDryRun);
  for (let r = 1; r <= repeat; r++) {
    RUN_ID = `${BASE_RUN_ID}/r${r}`;
    freshLabFor(personas, isDryRun);
    await runAll(personas, sessions, isDryRun);
  }
}

async function runAll(personas: Persona[], sessions: number[], isDryRun: boolean): Promise<void> {
  const gates = barriers(PERSONAS);
  // A persona outside this run cannot hold anybody up.
  for (const p of PERSONAS)
    if (!personas.includes(p)) for (const n of [1, 2, 3]) gates.get(`${p.key}:${n}`)?.resolve();

  await Promise.all(
    personas.map(async (p) => {
      for (const n of [1, 2, 3]) {
        const gate = gates.get(`${p.key}:${n}`);
        try {
          if (!sessions.includes(n)) continue;
          const after = p.sessions[n - 1].after;
          if (after && !isDryRun) await gates.get(`${after.persona}:${after.session}`)?.promise;
          await runSession(p, n, isDryRun);
        } finally {
          gate?.resolve();
        }
      }
    }),
  );
  if (!isDryRun) console.log(`[lab] run ${RUN_ID} in ${join(RUNS, RUN_ID)}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => disconnect());
