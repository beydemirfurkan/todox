import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { observationPayload, type ObserverGit } from "../observer";
import type { RpcClient } from "../rpc-client";

/**
 * The third carrier: what a commit did, for any client or none.
 *
 * A git hook knows nothing of agents or sessions, so it makes one: a machine,
 * a branch and a day, under which every commit of that day updates one row.
 * It sends what the other two carriers send, through the same function, with
 * `source: "git-hook"` -- and the server drops it while stdio or the Claude
 * Code plugin has written for this project in the last half hour, because a
 * commit made inside an agent's session belongs to that session's row.
 *
 * What it remembers between commits sits in the repository's git dir, never
 * in the working tree, so there is nothing to commit and nothing to ignore.
 */
export interface CommitGit extends ObserverGit {
  parent(dir: string): string | undefined;
  gitDir(dir: string): string | undefined;
  /** `origin`, credentials scrubbed: how the server finds a known repo at a new path. */
  remote(dir: string): string | undefined;
}

export interface CommitContext {
  event: string;
  cwd: string;
  git: CommitGit;
  rpc: RpcClient;
  log: (event: string, message: string) => void;
  now: () => Date;
}

/** One file per repository, beside git's own state. */
export const STATE_FILE = "todox-observe.json";

interface CommitState {
  session: string;
  base: string;
  head: string;
  dirty: number;
  startedAt: string;
  widened: boolean;
}

export const CLIENT = "git-hook";

export type Outcome = "sent" | "skipped-by-server" | "unchanged" | "rebasing" | "not-a-checkout" | "no-history";

export async function observeCommit(ctx: CommitContext): Promise<Outcome> {
  const { git } = ctx;
  const dir = git.root(ctx.cwd);
  const gitDir = dir ? git.gitDir(dir) : undefined;
  const head = dir ? git.head(dir) : undefined;
  if (!dir || !gitDir) return "not-a-checkout";
  if (!head) return "no-history";
  // A rebase runs post-commit once per replayed commit; post-rewrite fires
  // once when it is done, and that is the one worth a round trip.
  if (ctx.event === "post-commit" && isRebasing(gitDir)) return "rebasing";

  const branch = git.branch(dir);
  const session = sessionKey(branch, ctx.now());
  const previous = readState(gitDir, ctx.log);
  const current = previous?.session === session ? previous : undefined;
  const dirty = git.dirty(dir) ?? 0;
  if (current && current.head === head && current.dirty === dirty) return "unchanged";

  const base = current?.base ?? git.parent(dir) ?? head;
  const since = git.since(dir, base);
  const startedAt = current?.startedAt ?? ctx.now().toISOString();
  const facts = {
    dir,
    sessionId: session,
    client: CLIENT,
    branch,
    base,
    head,
    commits: since?.count ?? 0,
    subjects: since?.subjects ?? [],
    dirty,
    taskIds: [],
    startedAt,
  };
  const remote = git.remote(dir);
  const send = (f: typeof facts) =>
    ctx.rpc("recordObservation", {
      ...observationPayload(f),
      source: "git-hook",
      ...(remote ? { repo_url: remote } : {}),
    }) as Promise<{
      last_head_sha?: string | null;
      skipped?: string;
    }>;

  const reply = await send(facts);
  let state: CommitState = { session, base, head, dirty, startedAt, widened: current?.widened ?? false };
  if (!reply.skipped && !state.widened) {
    state = { ...state, widened: true };
    const wider = reply.last_head_sha && reply.last_head_sha !== base ? git.since(dir, reply.last_head_sha) : undefined;
    if (wider && reply.last_head_sha) {
      await send({ ...facts, base: reply.last_head_sha, commits: wider.count, subjects: wider.subjects });
      state = { ...state, base: reply.last_head_sha };
    }
  }
  writeFileSync(join(gitDir, STATE_FILE), JSON.stringify(state));
  return reply.skipped ? "skipped-by-server" : "sent";
}

/**
 * `git:<machine>:<branch>:<day>`. The machine is a short hash of the host
 * name: it only has to tell two computers apart, and the name itself says
 * more about a person than a session id needs to. The day is local, because
 * "today's work" is the developer's day, not UTC's.
 */
export function sessionKey(branch: string | undefined, now: Date): string {
  const machine = createHash("sha256").update(hostname()).digest("hex").slice(0, 8);
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `git:${machine}:${branch || "detached"}:${day}`;
}

const isRebasing = (gitDir: string) =>
  existsSync(join(gitDir, "rebase-merge")) || existsSync(join(gitDir, "rebase-apply"));

function readState(gitDir: string, log: CommitContext["log"]): CommitState | undefined {
  const path = join(gitDir, STATE_FILE);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CommitState;
  } catch (e) {
    log("state", `${STATE_FILE} unreadable, starting over: ${(e as Error).message}`);
    return undefined;
  }
}
