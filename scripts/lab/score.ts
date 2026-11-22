/**
 * Scores a lab run from what the sessions left behind -- deterministic, no
 * model in the loop, so two runs compare.
 *
 *   pnpm lab:score                 today's run
 *   TODOX_LAB_RUN=<id> pnpm lab:score
 *
 * A repeated run (`lab:run --repeat N`) holds r1, r2, ... under its id: each
 * is scored on its own, and the run's own scores.md puts their totals side by
 * side, because one run of a model is an anecdote and two disagreeing ones
 * are the error bar.
 *
 * Reads each session's transcript (Claude Code stream-json or OpenCode json,
 * normalised to one list of tool calls), its meta.json and its state.json, and
 * writes scores.json and scores.md beside them.
 *
 * Four questions, one block each:
 * - continuity: did a later session start from todox, and does its answer
 *   carry something only an earlier session knew (`recall` in personas.ts)?
 * - discipline: did it leave a handoff, the right statuses, short entries?
 * - cost: briefing bytes, todox calls, refusals, dollars and minutes.
 * - contamination: anything that could have carried memory besides todox.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { RUNS } from "./paths";
import { PERSONAS, type Persona, type Session } from "./personas";

const RUN_ID = process.env.TODOX_LAB_RUN ?? new Date().toISOString().slice(0, 10);
const RUN_DIR = join(RUNS, RUN_ID);

interface ToolCall {
  /** A todox method name (`get_context`) or the agent's own tool (`Bash`). */
  name: string;
  isTodox: boolean;
  input: Record<string, unknown>;
  output: string;
  isError: boolean;
}

interface Transcript {
  calls: ToolCall[];
  finalText: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
}

interface Entry {
  id: number;
  task_id: number;
  kind: string;
  author: string;
  body: string;
  by_user: string | null;
  created_at: string;
  answers_entry_id: number | null;
}

interface State {
  projects: { id: number; slug: string; owner: string }[];
  tasks: { id: number; project_id: number; title: string; status: string; updated_at: string }[];
  entries: Entry[];
  contexts: { id: number; kind: string; title: string; by_user: string; created_at: string }[];
}

interface Meta {
  agent: Session["agent"];
  model: string;
  project: string;
  startedAt: string;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string =>
  typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value.map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : "")).join("")
      : value === undefined
        ? ""
        : JSON.stringify(value);

/** `mcp__todox__get_context` (Claude Code), `todox_get_context` (OpenCode). */
function todoxMethod(tool: string): string | undefined {
  const match = /todox[_.]+(\w+)$/.exec(tool);
  return match ? match[1].replace(/^_+/, "") : undefined;
}

function readLines(file: string): Record<string, unknown>[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line) as unknown)
    .filter(isRecord);
}

function parseClaude(lines: Record<string, unknown>[]): Transcript {
  const calls = new Map<string, ToolCall>();
  const result: Transcript = { calls: [], finalText: "", costUsd: 0, tokensIn: 0, tokensOut: 0 };
  for (const line of lines) {
    const message = isRecord(line.message) ? line.message : undefined;
    const content = Array.isArray(message?.content) ? message.content.filter(isRecord) : [];
    if (line.type === "assistant")
      for (const part of content)
        if (part.type === "tool_use" && typeof part.name === "string" && typeof part.id === "string") {
          const method = todoxMethod(part.name);
          const call: ToolCall = {
            name: method ?? part.name,
            isTodox: method !== undefined,
            input: isRecord(part.input) ? part.input : {},
            output: "",
            isError: false,
          };
          calls.set(part.id, call);
          result.calls.push(call);
        }
    if (line.type === "user")
      for (const part of content)
        if (part.type === "tool_result" && typeof part.tool_use_id === "string") {
          const call = calls.get(part.tool_use_id);
          if (!call) continue;
          call.output = text(part.content);
          call.isError = part.is_error === true;
        }
    if (line.type === "result") {
      result.finalText = text(line.result);
      result.costUsd = typeof line.total_cost_usd === "number" ? line.total_cost_usd : 0;
      const usage = isRecord(line.usage) ? line.usage : {};
      result.tokensIn =
        Number(usage.input_tokens ?? 0) +
        Number(usage.cache_read_input_tokens ?? 0) +
        Number(usage.cache_creation_input_tokens ?? 0);
      result.tokensOut = Number(usage.output_tokens ?? 0);
    }
  }
  return result;
}

/**
 * OpenCode 2 runs MCP tools in "code mode": one `execute` call whose input is
 * a script calling `tools.todox.get_context({...})`. Each call in the script
 * is a todox call; its arguments are read loosely, by key, because the script
 * is JavaScript and not JSON. The output belongs to the whole script.
 */
function codeModeCalls(state: Record<string, unknown>): ToolCall[] {
  const code = isRecord(state.input) && typeof state.input.code === "string" ? state.input.code : "";
  const output = text(state.output ?? state.error);
  const isError = state.status === "error" || /^Invalid arguments|"error"\s*:/.test(output);
  const starts = [...code.matchAll(/tools\.todox\.(\w+)\(/g)];
  // Each call's arguments run to the next call (or the end): a body may hold
  // any character, a closing parenthesis included, so no pattern can end it.
  return starts.map((match, i) => {
    const args = code.slice(match.index + match[0].length, starts[i + 1]?.index ?? code.length);
    const input: Record<string, unknown> = {};
    for (const key of ["cwd", "focus", "kind", "project", "status", "answers_entry_id"]) {
      const value = new RegExp(`\\b${key}\\s*:\\s*("([^"]*)"|'([^']*)'|[\\w.]+)`).exec(args);
      if (value) input[key] = value[2] ?? value[3] ?? value[1];
    }
    return { name: match[1], isTodox: true, input, output, isError };
  });
}

function parseOpenCode(lines: Record<string, unknown>[]): Transcript {
  const result: Transcript = { calls: [], finalText: "", costUsd: 0, tokensIn: 0, tokensOut: 0 };
  const texts: string[] = [];
  for (const line of lines) {
    const part = isRecord(line.part) ? line.part : {};
    if (line.type === "tool_use" && part.tool === "execute") {
      result.calls.push(...codeModeCalls(isRecord(part.state) ? part.state : {}));
      continue;
    }
    if (line.type === "tool_use" && typeof part.tool === "string") {
      const state = isRecord(part.state) ? part.state : {};
      const method = todoxMethod(part.tool);
      result.calls.push({
        name: method ?? part.tool,
        isTodox: method !== undefined,
        input: isRecord(state.input) ? state.input : {},
        output: text(state.output ?? state.error),
        isError: state.status === "error",
      });
    }
    if (line.type === "text" && typeof part.text === "string") texts.push(part.text);
    if (line.type === "step_finish") {
      result.costUsd += Number(part.cost ?? 0);
      const tokens = isRecord(part.tokens) ? part.tokens : {};
      const cache = isRecord(tokens.cache) ? tokens.cache : {};
      result.tokensIn += Number(tokens.input ?? 0) + Number(cache.read ?? 0) + Number(cache.write ?? 0);
      result.tokensOut += Number(tokens.output ?? 0) + Number(tokens.reasoning ?? 0);
    }
  }
  // The last message is the answer; the earlier ones narrate the work.
  result.finalText = texts.at(-1) ?? "";
  return result;
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "edit", "write", "patch"]);
/** A todox error answers in its text even when the transport calls it a success. */
const isRefusal = (call: ToolCall) =>
  call.isTodox && (call.isError || /"error"\s*:|\brefused\b|bad_request|invalid_params/i.test(call.output.slice(0, 400)));

function scoreSession(runDir: string, p: Persona, n: number) {
  const dir = join(runDir, `${p.key}-s${n}`);
  if (!existsSync(join(dir, "meta.json"))) return undefined;
  const session = p.sessions[n - 1];
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as Meta;
  const state = JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as State;
  const lines = existsSync(join(dir, "transcript.jsonl")) ? readLines(join(dir, "transcript.jsonl")) : [];
  const transcript = meta.agent === "claude" ? parseClaude(lines) : parseOpenCode(lines);

  const todox = transcript.calls.filter((call) => call.isTodox);
  const firstEdit = transcript.calls.findIndex((call) => EDIT_TOOLS.has(call.name));
  const firstContext = transcript.calls.findIndex((call) => call.name === "get_context");
  const contexts = todox.filter((call) => call.name === "get_context");
  const logs = todox.filter((call) => call.name === "log_entry");
  const kindsLogged = logs.map((call) => String(call.input.kind ?? "?"));
  const mine = state.entries.filter(
    (entry) => entry.by_user === p.username && entry.created_at >= meta.startedAt,
  );
  const firstLines = mine.map((entry) => entry.body.split("\n")[0]);
  // Context notes, which carry the why of work finished without a task --
  // the thing the first run found missing (B5). From the state, not the
  // calls, so a refused add_context does not count.
  const notesWritten = state.contexts.filter(
    (note) => note.by_user === p.username && note.created_at >= meta.startedAt,
  ).length;
  const projectIds = new Set(
    state.tasks.filter((task) => task.updated_at >= meta.startedAt).map((task) => task.project_id),
  );
  const leftDoing = state.tasks.filter(
    (task) => task.status === "doing" && task.updated_at >= meta.startedAt,
  );
  const recall = session.recall ? new RegExp(session.recall, "i").test(transcript.finalText) : undefined;

  return {
    persona: p.key,
    session: n,
    agent: meta.agent,
    model: meta.model,
    project: session.project,
    ok: meta.exitCode === 0 && !meta.timedOut,
    minutes: Math.round(meta.durationMs / 6000) / 10,
    costUsd: Math.round(transcript.costUsd * 1000) / 1000,
    tokensIn: transcript.tokensIn,
    tokensOut: transcript.tokensOut,
    continuity: {
      contextFirst: firstContext !== -1 && (firstEdit === -1 || firstContext < firstEdit),
      contextCalls: contexts.length,
      contextWithCwd: contexts.some((call) => typeof call.input.cwd === "string"),
      contextWithFocus: contexts.some((call) => typeof call.input.focus === "string"),
      briefingBytes: contexts.reduce((sum, call) => sum + Buffer.byteLength(call.output), 0),
      searched: todox.some((call) => call.name === "search"),
      fileContext: todox.some((call) => call.name === "get_file_context"),
      recall,
    },
    discipline: {
      tasksCreated: todox.filter((call) => call.name === "create_task").length,
      statusMoves: todox.filter((call) => call.name === "update_task").length,
      kindsLogged,
      notesAdded: todox.filter((call) => call.name === "add_context").length,
      handoff: kindsLogged.includes("handoff"),
      sessionStatus: todox.some((call) => call.name === "session_status"),
      leftDoing: leftDoing.map((task) => task.id),
      answeredQuestion: session.answersQuestion
        ? mine.some((entry) => entry.answers_entry_id !== null)
        : undefined,
      entriesWritten: mine.length,
      notesWritten,
      avgFirstLine: mine.length
        ? Math.round(firstLines.reduce((sum, line) => sum + line.length, 0) / mine.length)
        : 0,
      avgBody: mine.length
        ? Math.round(mine.reduce((sum, entry) => sum + entry.body.length, 0) / mine.length)
        : 0,
      projectsTouched: projectIds.size,
    },
    cost: {
      todoxCalls: todox.length,
      allCalls: transcript.calls.length,
      refusals: todox.filter(isRefusal).map((call) => `${call.name}: ${call.output.slice(0, 160)}`),
    },
  };
}

type SessionScore = NonNullable<ReturnType<typeof scoreSession>>;

/** Anything that could have carried memory from one session to the next besides todox. */
function contamination(): string[] {
  const projectsDir = join(homedir(), ".claude", "projects");
  if (!existsSync(projectsDir)) return [];
  return readdirSync(projectsDir)
    .filter((name) => name.includes("todox-lab"))
    .filter((name) => existsSync(join(projectsDir, name, "memory")))
    .map((name) => `Claude Code auto-memory exists for ${name}`);
  // Not detected here: rows a rolled-back session left behind (a task body,
  // an observation). Roll back with care, or rerun from `lab:setup --reset`.
}

const yes = (value: boolean | undefined) => (value === undefined ? "–" : value ? "✓" : "✗");

function table(scores: SessionScore[]): string {
  const head =
    "| persona | s | agent | ok | min | $ | ctx first | cwd | focus | brief KB | recall | handoff | doing left | entries | avg 1st line | refusals | todox calls |";
  const rule = `|${head.split("|").slice(1, -1).map(() => "---").join("|")}|`;
  const rows = scores.map((s) =>
    [
      s.persona,
      s.session,
      s.agent,
      yes(s.ok),
      s.minutes,
      s.costUsd,
      yes(s.continuity.contextFirst),
      yes(s.continuity.contextWithCwd),
      yes(s.continuity.contextWithFocus),
      (s.continuity.briefingBytes / 1024).toFixed(1),
      yes(s.continuity.recall),
      yes(s.discipline.handoff),
      s.discipline.leftDoing.length,
      s.discipline.entriesWritten,
      s.discipline.avgFirstLine,
      s.cost.refusals.length,
      s.cost.todoxCalls,
    ].join(" | "),
  );
  return [head, rule, ...rows.map((row) => `| ${row} |`)].join("\n");
}

function summary(scores: SessionScore[]) {
  const later = scores.filter((s) => s.session > 1);
  const rate = (list: SessionScore[], pick: (s: SessionScore) => boolean | undefined) => {
    const known = list.filter((s) => pick(s) !== undefined);
    return known.length ? `${known.filter((s) => pick(s)).length}/${known.length}` : "–";
  };
  return {
    sessions: scores.length,
    finished: rate(scores, (s) => s.ok),
    contextFirst: rate(scores, (s) => s.continuity.contextFirst),
    recallLater: rate(later, (s) => s.continuity.recall),
    handoff: rate(scores, (s) => s.discipline.handoff),
    answeredQuestion: rate(scores, (s) => s.discipline.answeredQuestion),
    leftDoing: scores.reduce((sum, s) => sum + s.discipline.leftDoing.length, 0),
    entries: scores.reduce((sum, s) => sum + s.discipline.entriesWritten, 0),
    notesWritten: scores.reduce((sum, s) => sum + s.discipline.notesWritten, 0),
    jonasEntries: scores
      .filter((s) => s.persona === "jonas")
      .reduce((sum, s) => sum + s.discipline.entriesWritten + s.discipline.notesWritten, 0),
    withoutTodox: scores.filter((s) => s.cost.todoxCalls === 0).map((s) => `${s.persona} s${s.session}`),
    refusals: scores.reduce((sum, s) => sum + s.cost.refusals.length, 0),
    costUsd: Math.round(scores.reduce((sum, s) => sum + s.costUsd, 0) * 100) / 100,
    minutes: Math.round(scores.reduce((sum, s) => sum + s.minutes, 0)),
  };
}

type Totals = ReturnType<typeof summary>;

/** Scores one run directory and writes its scores.json and scores.md. */
function scoreRun(runDir: string, runId: string): { totals: Totals; md: string } {
  const scores = PERSONAS.flatMap((p) =>
    [1, 2, 3].map((n) => scoreSession(runDir, p, n)).filter((s): s is SessionScore => s !== undefined),
  );
  const totals = summary(scores);
  const leaks = contamination();
  writeFileSync(join(runDir, "scores.json"), JSON.stringify({ run: runId, totals, leaks, scores }, null, 2));
  const refusals = scores.flatMap((s) => s.cost.refusals.map((r) => `- ${s.persona} s${s.session}: ${r}`));
  const md = [
    `# Lab run ${runId}`,
    "",
    "```json",
    JSON.stringify(totals, null, 2),
    "```",
    "",
    table(scores),
    "",
    "## Refusals",
    "",
    refusals.length ? refusals.join("\n") : "None.",
    "",
    "## Contamination",
    "",
    leaks.length ? leaks.map((line) => `- ${line}`).join("\n") : "None found.",
    "",
  ].join("\n");
  writeFileSync(join(runDir, "scores.md"), md);
  return { totals, md };
}

/** The repetitions of a repeated run, in order: r1, r2, ... */
const repetitionsOf = (runDir: string): string[] =>
  readdirSync(runDir)
    .filter((name) => /^r\d+$/.test(name))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

/** One row per total, one column per repetition. */
function sideBySide(runs: { name: string; totals: Totals }[]): string {
  const keys = Object.keys(runs[0]!.totals) as (keyof Totals)[];
  const head = `| total | ${runs.map((r) => r.name).join(" | ")} |`;
  const rule = `|---|${runs.map(() => "---").join("|")}|`;
  const cell = (value: unknown) => (Array.isArray(value) ? value.join(", ") || "–" : String(value));
  const rows = keys.map((key) => `| ${key} | ${runs.map((r) => cell(r.totals[key])).join(" | ")} |`);
  return [head, rule, ...rows].join("\n");
}

function main(): void {
  if (!existsSync(RUN_DIR)) throw new Error(`no run at ${RUN_DIR}`);
  const reps = repetitionsOf(RUN_DIR);
  if (reps.length === 0) {
    console.log(scoreRun(RUN_DIR, RUN_ID).md);
    return;
  }
  const runs = reps.map((name) => ({ name, ...scoreRun(join(RUN_DIR, name), `${RUN_ID}/${name}`) }));
  writeFileSync(
    join(RUN_DIR, "scores.json"),
    JSON.stringify({ run: RUN_ID, repetitions: runs.map((r) => ({ name: r.name, totals: r.totals })) }, null, 2),
  );
  const md = [
    `# Lab run ${RUN_ID}, ${runs.length} repetitions`,
    "",
    sideBySide(runs),
    "",
    ...runs.map((r) => `Per session: [${r.name}/scores.md](${r.name}/scores.md)`),
    "",
  ].join("\n");
  writeFileSync(join(RUN_DIR, "scores.md"), md);
  console.log(md);
}

main();
