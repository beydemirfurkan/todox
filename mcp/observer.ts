/**
 * What the session did to the tree, noticed rather than reported.
 *
 * Everything else todox stores was written by somebody who chose to write it.
 * This is the exception, and the reason it exists is the session that ends
 * without a handoff: the agent stopped, or the process was killed, and the
 * next session opens knowing nothing -- not even what changed on disk.
 *
 * It lives here rather than in `tools.ts` on purpose. The agent surface is
 * defined once and this is not part of it: there is no tool, the model cannot
 * call it and cannot see it. The carrier is the stdio process, which wraps
 * every tool call on its way out, so the observer rides along on work the
 * agent was doing anyway.
 *
 * Two properties matter more than anything this file computes:
 *
 *   - it never throws. It sits inside somebody else's tool call, so an
 *     exception here breaks work that has nothing to do with it.
 *   - it stays quiet. A session that changes nothing writes nothing, and the
 *     briefing is the payload every session opens with -- a row that carries
 *     no information is a row that makes the next one cost more for less.
 */

/**
 * How long to wait between writes for the same state.
 *
 * The observer runs inside the agent's tool calls and an agent in a busy
 * stretch makes a lot of them, all spending the same token bucket as its real
 * work. A commit is exempt: it is the event a dying session would otherwise
 * lose, and it is rare enough to be free.
 */
export const THROTTLE_MS = 60_000;

export type ObserverGit = {
  root(path: string): string | undefined;
  head(dir: string): string | undefined;
  branch(dir: string): string | undefined;
  dirty(dir: string): number | undefined;
  since(dir: string, base: string): { count: number; subjects: string[] } | undefined;
};

export type ObserverOptions = {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
  git: ObserverGit;
  /** One row is kept per session per project, keyed on this. */
  sessionId: string;
  /** Where the client launched this process, and the fallback repository. */
  cwd: string;
  client?: string;
  /** `TODOX_OBSERVE=off` turns the whole write path off without a deploy. */
  enabled?: boolean;
  clock?: () => number;
};

/** Tools that carry a path carry it under one of these. */
const PATH_KEYS = ["cwd", "path", "root_path"] as const;

const pathFrom = (params: Record<string, unknown>): string | undefined => {
  for (const key of PATH_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
};

export function createObserver(options: ObserverOptions) {
  const clock = options.clock ?? Date.now;
  const enabled = options.enabled ?? true;
  const startedAt = new Date().toISOString();

  let root: string | undefined;
  /**
   * Where HEAD was when the session opened -- read now rather than at the
   * first tool call, because an agent that commits before it next touches
   * todox would otherwise have that commit swallowed into its own baseline.
   */
  let base: string | undefined;

  let wrote = false;
  let widened = false;
  let lastWriteAt = 0;
  let lastHead: string | undefined;
  let lastDirty: number | undefined;

  /**
   * At most one observation in flight, and at most one waiting behind it.
   *
   * `notice` is fired with `void` after every tool call, and an agent working
   * in parallel fires several at once. Two bodies interleaving is not a
   * tidiness problem. Every decision below reads state that the previous write
   * was supposed to have set, and none of it is set until that write comes
   * back: on the first pair `wrote` is still false for both, so both write,
   * and the throttle that exists to keep this cheap never gets a chance to
   * say no.
   *
   * The widening is the one that actually loses data. One call reads the
   * server's older baseline, widens the window and rewrites the row; the other
   * finishes with the narrow window it computed before any of that and
   * overwrites it -- and `widened` is now true, so nothing tries again. What
   * is lost is precisely the work a killed session never reported, which is
   * the reason this file exists.
   *
   * The one waiting is coalesced rather than queued. A notice carries no
   * payload of its own -- it is a nudge to go and look at the checkout -- so
   * the newest state is the only one worth writing, and a queue that grows
   * with the agent's tool calls is a queue that outlives the session.
   */
  let inFlight: Promise<void> | undefined;
  let waiting = false;

  /** Resolve the repository, from a path a tool offered or from our own cwd. */
  function locate(params: Record<string, unknown>): string | undefined {
    if (root) return root;
    const hint = pathFrom(params);
    // Not latched on failure: most tools carry no path at all, so the first
    // few calls of a session can legitimately have nothing to go on.
    root = (hint ? options.git.root(hint) : undefined) ?? options.git.root(options.cwd);
    if (root && base === undefined) base = options.git.head(root);
    return root;
  }

  try {
    root = options.git.root(options.cwd);
    if (root) base = options.git.head(root);
  } catch {
    // A checkout that cannot be read is one we do not observe.
  }

  async function send(
    dir: string,
    from: string,
    head: string,
    commits: number,
    subjects: string[],
    dirty: number,
  ): Promise<unknown> {
    return options.call("recordObservation", {
      cwd: dir,
      session_id: options.sessionId,
      client: options.client,
      branch: options.git.branch(dir),
      base_sha: from,
      head_sha: head,
      commits,
      files_changed: dirty,
      commit_subjects: subjects.length ? subjects.join("\n") : undefined,
      started_at: startedAt,
    });
  }

  async function observe(params: Record<string, unknown>): Promise<void> {
    const dir = locate(params);
    if (!dir) return;

    const head = options.git.head(dir);
    // No HEAD means a repository with no commits. There is nothing to compare
    // against, and "0 commits" is a row that says nothing at all.
    if (!head) return;
    if (base === undefined) base = head;

    const dirty = options.git.dirty(dir) ?? 0;
    const since = options.git.since(dir, base);
    const commits = since?.count ?? 0;

    if (commits === 0 && dirty === 0) return;

    if (wrote) {
      const headMoved = head !== lastHead;
      const stateChanged = headMoved || dirty !== lastDirty;
      const throttled = clock() - lastWriteAt < THROTTLE_MS;
      if (!headMoved && (throttled || !stateChanged)) return;
    }

    const reply = await send(dir, base, head, commits, since?.subjects ?? [], dirty);

    wrote = true;
    lastWriteAt = clock();
    lastHead = head;
    lastDirty = dirty;

    /**
     * The correction that makes a killed session recoverable.
     *
     * The server answers with the last HEAD it recorded for this project. If
     * that is behind where this session started, the difference is work the
     * previous session made and never got to report -- so the window is
     * widened backwards and the row rewritten in place. Once per session: the
     * gap is a fact about the past and does not grow.
     *
     * A baseline git cannot resolve is left alone. It was rebased away, or it
     * came from another machine's checkout, and replacing a true small number
     * with no number is not an improvement.
     */
    if (widened) return;
    widened = true;

    const previous = (reply as { last_head_sha?: string | null } | null)?.last_head_sha;
    if (!previous || previous === base) return;

    const wider = options.git.since(dir, previous);
    if (!wider) return;

    base = previous;
    await send(dir, previous, head, wider.count, wider.subjects, dirty);
  }

  /** `observe`, with the contract that makes `void notice(...)` safe. */
  async function observeQuietly(params: Record<string, unknown>): Promise<void> {
    try {
      await observe(params);
    } catch {
      // Deliberately silent. This runs inside the agent's own tool call, and a
      // message here would attach a failure to work that did not cause it.
    }
  }

  return {
    /**
     * Called after every tool call the agent makes. Fire-and-forget by
     * contract: it resolves whatever happens, so a caller can `void` it
     * without wrapping it.
     */
    async notice(params: Record<string, unknown>): Promise<void> {
      if (!enabled) return;

      if (inFlight) {
        // Somebody is already lined up to look again once the current write
        // lands, and they will see this state too. A second waiter would only
        // write the same row twice.
        if (waiting) return;
        waiting = true;
        // `observeQuietly` never rejects, so there is nothing here to catch.
        await inFlight;
        waiting = false;
      }

      // Assigned before anything can yield: `observeQuietly` runs its git
      // reads synchronously, so no other notice sees an empty `inFlight`.
      const run = observeQuietly(params);
      inFlight = run;
      await run;
      if (inFlight === run) inFlight = undefined;
    },
  };
}
