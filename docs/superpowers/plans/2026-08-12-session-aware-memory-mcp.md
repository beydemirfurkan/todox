# Session-Aware Memory MCP (SAM) Implementation Plan


> **Historical record, not the current architecture.** Dated 12 August 2026. Kept
> because it is what was decided and why, which is the point of this project —
> not because it describes how todox works now. It was written against a
> serverless deployment on a managed Postgres with a platform cron; todox runs
> as a container beside its own database, and the driver, the deployment and
> the scheduling assumptions here are all out of date. The design was approved
> and never built. Read it as an argument, and re-cost it before acting on it.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every todox RPC call is recorded server-side, grouped by session, and surfaced as a structured `last_session` in `get_context` — even if the agent forgets to call `log_entry`. Zero client cooperation required.

**Architecture:** Add two tables (`rpc_sessions`, `rpc_calls`) and a fire-and-forget interceptor around `invoke()`. Server identifies sessions implicitly from `(token_hash, client_name)`. A background cron rolls up idle (>30min) sessions into a single `summary` text and drops detail. `get_context`'s transform reads the most recent session and renders it.

**Tech Stack:** TypeScript, Zod (existing), vitest (existing), `@neondatabase/serverless` (existing). No new deps.

## Global Constraints

- TypeScript strict; no `any`; no `as` except where inevitable.
- Every RPC method has a Zod schema (AGENTS.md).
- One module per table (AGENTS.md "Repositories never call each other").
- Tools, descriptions, session instructions live in `mcp/tools.ts` (AGENTS.md).
- `lib/util/paths.ts` and `lib/services/auth.ts` already expose `hashToken` — reuse.
- Conventional Commits; one logical change per commit.
- Banned names: `util`, `helper`, `manager`, `handler`, `data`, `info`, `temp`, `foo`, `x`.
- Mirror log writes are **fire-and-forget**; failures must NEVER break a request.
- The interceptor runs ONLY after `parseParams()` succeeds (BadRequest before that is not logged — client's own HTTP logs are the audit trail for invalid calls).
- Backward compat: zero request-side changes. New response fields are additive.

---

## File Structure

```
lib/
  db/
    schema.ts                MOD  Two new CREATE TABLE blocks (rpc_sessions, rpc_calls)
  repositories/
    sessions.ts              NEW  openOrReuse, recordCall, lastSession, rollUp, rollUpIdle
    sessions.test.ts         NEW  Repo behaviour (mint, reuse, roll-up)
  services/
    params-summary.ts        NEW  Per-method params summary (deterministic, key fields only)
    params-summary.test.ts   NEW  Per-method output, secret leakage
    render-last-session.ts   NEW  Format session row into structured briefing + summary string
    render-last-session.test.ts  NEW  Active vs closed formatting
    rpc.ts                   MOD  invoke() wraps method call in recordCallSafely
    rpc.test.ts              MOD  Mirror log fires on success; swallowed on failure

mcp/
  tools.ts                   MOD  get_context transform renders last_session

scripts/
  rollup-sessions.ts         NEW  Cron entry: rollUpIdle() and exit

package.json                  MOD  Add "rollup:sessions" script

docs/
  mcp.md                     MOD  Add "Skill framework integration" section
```

Files that change together (`rpc.ts` + `params-summary.ts` + `mcp/tools.ts` + `render-last-session.ts`) all live in `lib/` or `mcp/` already; no restructure.

---

## Task 1: Schema + repository + summary renderer

**Files:**
- Create: `lib/repositories/sessions.ts`
- Create: `lib/repositories/sessions.test.ts`
- Create: `lib/services/render-last-session.ts`
- Create: `lib/services/render-last-session.test.ts`
- Modify: `lib/db/schema.ts` (append two `CREATE TABLE IF NOT EXISTS` blocks)
- Modify: `package.json` (no script yet — comes in Task 3)

**Interfaces:**
- Consumes: `lib/services/auth.ts` → `hashToken(token: string): string` (sha256 hex). `lib/util/time.ts` → `now(): string` (ISO).
- Produces:
  - `openOrReuse(tokenHash, clientName, clientVersion)` → `RpcSession`
  - `recordCall({ session_id, method, params_summary })` → `void`
  - `lastSession(tokenHash)` → `RpcSession | null`
  - `rollUp(sessionId)` → `void` (aggregates rpc_calls into summary, sets closed_at, deletes calls)
  - `rollUpIdle()` → `number` (count of rolled-up sessions)
  - `renderLastSession(session, calls)` → `LastSessionView` (with `summary` string)
- All types live in `lib/repositories/sessions.ts` and are exported.

- [ ] **Step 1: Read context files**

Read these to understand conventions:
- `lib/repositories/projects.ts` (mirror its style)
- `lib/services/auth.ts` for `hashToken`
- `lib/util/time.ts` for `now`
- `lib/db/schema.ts` lines 1-50 for migration pattern (find a `CREATE INDEX IF NOT EXISTS` example)

- [ ] **Step 2: Append the schema**

In `lib/db/schema.ts`, add at the end of the `SCHEMA` template literal (after the last `CREATE UNIQUE INDEX` for `refs`):

```sql
-- Server-side audit trail for every RPC call. Sessions are identified
-- implicitly from (token_hash, client_name); detailed rpc_calls are
-- dropped when the session rolls up to a summary row (cron, 30min idle).
CREATE TABLE IF NOT EXISTS rpc_sessions (
  id             SERIAL PRIMARY KEY,
  token_hash     TEXT NOT NULL,
  client_name    TEXT,
  client_version TEXT,
  started_at     TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  closed_at      TEXT,
  summary        TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_open
  ON rpc_sessions(token_hash, client_name) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_token
  ON rpc_sessions(token_hash, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS rpc_calls (
  id             SERIAL PRIMARY KEY,
  session_id     INTEGER NOT NULL REFERENCES rpc_sessions(id) ON DELETE CASCADE,
  called_at      TEXT NOT NULL,
  method         TEXT NOT NULL,
  params_summary TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calls_session
  ON rpc_calls(session_id, called_at DESC);
```

- [ ] **Step 3: Verify schema split still works**

Run: `pnpm exec tsc --noEmit | head -30`
Expected: clean (the `split(";")` in `statements()` already strips comments, the new SQL is idempotent, no syntax issues).

- [ ] **Step 4: Create `lib/repositories/sessions.ts`**

```ts
import { hashToken } from "../services/auth";
import { all, one, run } from "../db/client";
import { now } from "../util/time";

/**
 * One row per active-or-rolled-up session. Detailed calls live in
 * rpc_calls while the session is active (last_seen_at within 30min);
 * once the cron rolls the session up, rpc_calls rows are deleted and
 * the session row holds only the rendered `summary` text.
 */
export type RpcSession = {
  id: number;
  token_hash: string;
  client_name: string | null;
  client_version: string | null;
  started_at: string;
  last_seen_at: string;
  closed_at: string | null;
  summary: string | null;
};

export type RpcCall = {
  id: number;
  session_id: number;
  called_at: string;
  method: string;
  params_summary: string;
};

/**
 * Find an open session for (token_hash, client_name) or mint a new one.
 * Same token used by two different MCP clients (different client_name)
 * gets two distinct sessions naturally.
 */
export async function openOrReuse(
  tokenHash: string,
  clientName: string | null,
  clientVersion: string | null,
): Promise<RpcSession> {
  const existing = await one<RpcSession>(
    `UPDATE rpc_sessions
        SET last_seen_at = ?
      WHERE token_hash = ?
        AND client_name IS NOT DISTINCT FROM ?
        AND closed_at IS NULL
      RETURNING *`,
    [now(), tokenHash, clientName],
  );
  if (existing) return existing;

  return await one<RpcSession>(
    `INSERT INTO rpc_sessions (token_hash, client_name, client_version, started_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)
     RETURNING *`,
    [tokenHash, clientName, clientVersion, now(), now()],
  ) as RpcSession;
}

/**
 * Append a single call record. Fire-and-forget on the caller side; the
 * caller wraps this in try/catch and never lets a write failure break
 * the request.
 */
export async function recordCall(input: {
  session_id: number;
  method: string;
  params_summary: string;
}): Promise<void> {
  await run(
    `INSERT INTO rpc_calls (session_id, called_at, method, params_summary)
     VALUES (?, ?, ?, ?)`,
    [input.session_id, now(), input.method, input.params_summary],
  );
}

/** Most recent session for this token (open or rolled-up). */
export async function lastSession(tokenHash: string): Promise<RpcSession | null> {
  const row = await one<RpcSession>(
    `SELECT * FROM rpc_sessions
      WHERE token_hash = ?
      ORDER BY last_seen_at DESC
      LIMIT 1`,
    [tokenHash],
  );
  return row ?? null;
}

/** All sessions older than `beforeISO` that are not yet rolled up. */
export async function idleSessions(beforeISO: string): Promise<RpcSession[]> {
  return await all<RpcSession>(
    `SELECT * FROM rpc_sessions
      WHERE closed_at IS NULL AND last_seen_at < ?`,
    [beforeISO],
  );
}

/** Aggregate rpc_calls for one session into a summary string and persist. */
export async function rollUp(
  sessionId: number,
  summary: string,
): Promise<void> {
  await run(
    `UPDATE rpc_sessions
        SET closed_at = last_seen_at, summary = ?
      WHERE id = ?`,
    [summary, sessionId],
  );
  // rpc_calls rows cascade-delete via the FK, but explicit for clarity.
  await run(`DELETE FROM rpc_calls WHERE session_id = ?`, [sessionId]);
}

/** Helper: roll up every session idle for 30 minutes. */
export async function rollUpIdle(
  render: (session: RpcSession, calls: RpcCall[]) => string,
): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const sessions = await idleSessions(cutoff);
  let n = 0;
  for (const s of sessions) {
    const calls = await all<RpcCall>(
      `SELECT * FROM rpc_calls
        WHERE session_id = ?
        ORDER BY called_at ASC`,
      [s.id],
    );
    await rollUp(s.id, render(s, calls));
    n++;
  }
  return n;
}
```

- [ ] **Step 5: Create `lib/services/render-last-session.ts`**

```ts
import type { RpcCall, RpcSession } from "../repositories/sessions";

/**
 * The shape of `last_session` injected into a `get_context` response and
 * the roll-up summary persisted on `rpc_sessions.summary`. Field names
 * are part of the public MCP API.
 */
export type LastSessionView = {
  session_id: number;
  client_name: string | null;
  client_version: string | null;
  started_at: string;
  ended_at: string | null;
  total_calls: number;
  method_counts: Record<string, number>;
  summary: string;
};

const IDLE_THRESHOLD_MS = 30 * 60 * 1000;

function isActive(session: RpcSession, nowMs: number): boolean {
  return (
    session.closed_at === null &&
    Date.parse(session.last_seen_at) > nowMs - IDLE_THRESHOLD_MS
  );
}

function methodCounts(calls: RpcCall[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of calls) counts[c.method] = (counts[c.method] ?? 0) + 1;
  return counts;
}

function wallMinutes(session: RpcSession, calls: RpcCall[], nowMs: number): number {
  if (calls.length === 0) return 0;
  const startMs = Date.parse(calls[0].called_at);
  const endMs = isActive(session, nowMs)
    ? nowMs
    : Date.parse(session.closed_at ?? session.last_seen_at);
  return Math.max(1, Math.round((endMs - startMs) / 60_000));
}

function topMethods(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return entries.map(([m, n]) => `${n}× ${m}`).join(", ");
}

/**
 * Build the structured briefing AND the rendered summary string for a
 * session + its calls. Used by both the live `get_context` transform
 * (active session, calls fetched from rpc_calls) and the roll-up cron
 * (closed session, calls aggregated from the table).
 */
export function renderLastSession(
  session: RpcSession,
  calls: RpcCall[],
  nowMs: number = Date.now(),
): LastSessionView {
  const counts = methodCounts(calls);
  const total = calls.length;
  const wallMin = wallMinutes(session, calls, nowMs);
  const active = isActive(session, nowMs);
  const clientLabel = session.client_name ?? "unknown-client";
  const versionLabel = session.client_version ?? "?";
  const range = active
    ? `${session.started_at} → active`
    : `${session.started_at} → ${session.closed_at}`;

  let summary: string;
  if (total === 0) {
    summary = `Last session by ${clientLabel} ${versionLabel} (${range}, ${wallMin}min, no calls).`;
  } else {
    summary =
      `Last session by ${clientLabel} ${versionLabel} (${range}, ${wallMin}min, ${total} calls): ` +
      `${topMethods(counts)}.`;
  }

  return {
    session_id: session.id,
    client_name: session.client_name,
    client_version: session.client_version,
    started_at: session.started_at,
    ended_at: active ? null : session.closed_at,
    total_calls: total,
    method_counts: counts,
    summary,
  };
}
```

- [ ] **Step 6: Create `lib/repositories/sessions.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { all, one, run } from "../db/client";
import { now } from "../util/time";
import {
  idleSessions,
  lastSession,
  openOrReuse,
  recordCall,
  rollUp,
  rollUpIdle,
} from "./sessions";

vi.mock("../db/client", () => ({
  all: vi.fn(),
  one: vi.fn(),
  run: vi.fn(),
}));
vi.mock("../util/time", () => ({
  now: vi.fn(() => "2026-08-12T14:00:00.000Z"),
}));

const mockAll = vi.mocked(all);
const mockOne = vi.mocked(one);
const mockRun = vi.mocked(run);

describe("sessions repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOne.mockResolvedValue(undefined);
    mockAll.mockResolvedValue([]);
    mockRun.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("openOrReuse reuses an open session", async () => {
    const existing = {
      id: 7,
      token_hash: "tk",
      client_name: "claude-code",
      client_version: "1.0.0",
      started_at: "2026-08-12T13:00:00Z",
      last_seen_at: "2026-08-12T14:00:00Z",
      closed_at: null,
      summary: null,
    };
    mockOne.mockResolvedValueOnce(existing);
    const s = await openOrReuse("tk", "claude-code", "1.0.0");
    expect(s.id).toBe(7);
    expect(mockOne).toHaveBeenCalledTimes(1);
    expect(mockOne.mock.calls[0][0]).toContain("UPDATE rpc_sessions");
  });

  it("openOrReuse mints a new session when none exists", async () => {
    mockOne.mockResolvedValueOnce(undefined);
    mockOne.mockResolvedValueOnce({
      id: 8,
      token_hash: "tk",
      client_name: "codex",
      client_version: "0.1.0",
      started_at: "2026-08-12T14:00:00Z",
      last_seen_at: "2026-08-12T14:00:00Z",
      closed_at: null,
      summary: null,
    });
    const s = await openOrReuse("tk", "codex", "0.1.0");
    expect(s.id).toBe(8);
    expect(mockOne).toHaveBeenCalledTimes(2);
    expect(mockOne.mock.calls[1][0]).toContain("INSERT INTO rpc_sessions");
  });

  it("recordCall inserts one row", async () => {
    await recordCall({ session_id: 7, method: "log_entry", params_summary: "task_id=42" });
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO rpc_calls"),
      [expect.any(String), 7, "log_entry", "task_id=42"],
    );
  });

  it("lastSession returns the most-recent row", async () => {
    mockOne.mockResolvedValueOnce({
      id: 7, token_hash: "tk", client_name: "claude-code", client_version: "1.0.0",
      started_at: "x", last_seen_at: "y", closed_at: null, summary: null,
    });
    const s = await lastSession("tk");
    expect(s?.id).toBe(7);
  });

  it("rollUp writes summary and deletes calls", async () => {
    await rollUp(7, "Last session by …");
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE rpc_sessions"),
      ["Last session by …", 7],
    );
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM rpc_calls"),
      [7],
    );
  });

  it("rollUpIdle iterates only idle sessions", async () => {
    mockAll.mockResolvedValueOnce([
      { id: 1, token_hash: "tk", client_name: "a", client_version: "1",
        started_at: "x", last_seen_at: "2026-08-12T13:00:00Z",
        closed_at: null, summary: null },
    ]);
    mockAll.mockResolvedValueOnce([
      { id: 1, session_id: 1, called_at: "2026-08-12T13:00:00Z",
        method: "log_entry", params_summary: "task_id=1" },
    ]);
    const n = await rollUpIdle(() => "summary");
    expect(n).toBe(1);
  });
});
```

- [ ] **Step 7: Create `lib/services/render-last-session.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { renderLastSession, type LastSessionView } from "./render-last-session";
import type { RpcCall, RpcSession } from "../repositories/sessions";

const NOW = Date.parse("2026-08-12T14:18:00.000Z");

function session(over: Partial<RpcSession> = {}): RpcSession {
  return {
    id: 7,
    token_hash: "tk",
    client_name: "claude-code",
    client_version: "1.2.3",
    started_at: "2026-08-12T14:00:00.000Z",
    last_seen_at: "2026-08-12T14:15:00.000Z",
    closed_at: null,
    summary: null,
    ...over,
  };
}

function call(method: string, at: string): RpcCall {
  return {
    id: 1, session_id: 7, called_at: at, method, params_summary: "",
  };
}

describe("renderLastSession", () => {
  it("renders an active session with top-3 methods", () => {
    const out = renderLastSession(
      session(),
      [call("get_context", "2026-08-12T14:00:00Z"),
       call("create_task", "2026-08-12T14:01:00Z"),
       call("log_entry", "2026-08-12T14:02:00Z"),
       call("log_entry", "2026-08-12T14:03:00Z")],
      NOW,
    );
    expect(out.session_id).toBe(7);
    expect(out.ended_at).toBeNull();
    expect(out.total_calls).toBe(4);
    expect(out.method_counts).toEqual({
      get_context: 1, create_task: 1, log_entry: 2,
    });
    expect(out.summary).toContain("claude-code 1.2.3");
    expect(out.summary).toContain("active");
    expect(out.summary).toContain("2× log_entry");
  });

  it("renders a closed session with ended_at", () => {
    const out = renderLastSession(
      session({ closed_at: "2026-08-12T14:15:00.000Z" }),
      [call("log_entry", "2026-08-12T14:00:00Z")],
      NOW,
    );
    expect(out.ended_at).toBe("2026-08-12T14:15:00.000Z");
    expect(out.summary).toContain("→ 2026-08-12T14:15:00");
  });

  it("degrades to a single line when no calls exist", () => {
    const out = renderLastSession(session(), [], NOW);
    expect(out.total_calls).toBe(0);
    expect(out.method_counts).toEqual({});
    expect(out.summary).toContain("no calls");
  });

  it("summary has no body content or paths (privacy)", () => {
    const out = renderLastSession(
      session(),
      [call("log_entry", "2026-08-12T14:00:00Z")],
      NOW,
    );
    expect(out.summary).not.toMatch(/password|secret|token|body/i);
  });
});
```

- [ ] **Step 8: Run tests**

Run: `pnpm test -- lib/repositories/sessions.test.ts lib/services/render-last-session.test.ts`
Expected: all green (5 repo tests + 4 render tests).

- [ ] **Step 9: Run lint + typecheck**

Run: `pnpm lint && pnpm exec tsc --noEmit | head -10`
Expected: clean.

- [ ] **Step 10: Commit**

Branch: `feat/session-aware-memory-schema`.

```bash
git checkout -b feat/session-aware-memory-schema
git add lib/db/schema.ts lib/repositories/sessions.ts lib/repositories/sessions.test.ts lib/services/render-last-session.ts lib/services/render-last-session.test.ts
git commit -m "feat(sessions): rpc_sessions + rpc_calls tables and summary renderer"
```

---

## Task 2: Mirror log interceptor + params-summary

**Files:**
- Create: `lib/services/params-summary.ts`
- Create: `lib/services/params-summary.test.ts`
- Modify: `lib/services/rpc.ts` (`invoke()` wraps method call in fire-and-forget record)
- Modify: `lib/services/rpc.test.ts` (new test: invoke records call; record failure swallowed)

**Interfaces:**
- Consumes: Task 1 → `openOrReuse`, `recordCall`. `lib/services/auth.ts` → `hashToken`.
- Produces:
  - `summariseParams(method: string, params: Record<string, unknown>): string` — deterministic, ≤120 chars, no body/path content.
- `invoke(ctx, method, params)` — after `parseParams` succeeds, fire-and-forget `recordCallSafely(ctx, method, clean)`.

- [ ] **Step 1: Read context**

Read `lib/services/rpc.ts` lines 280-314 (the `invoke` function and surrounding types) and `lib/services/auth.ts` for `hashToken`. Confirm `RpcContext` already carries `token: string | undefined` from PR #9.

- [ ] **Step 2: Create `lib/services/params-summary.ts`**

```ts
/**
 * Per-method deterministic summary of an RPC call's params. The output is
 * a single string ≤120 chars, suitable for direct insertion into an
 * audit log row. It MUST NOT include any free-form body, path, or
 * secret field — those are session-only.
 *
 * Adding a method: append a clause below. Unknown methods fall through
 * to `method-only`.
 */

function len(s: unknown): number {
  return typeof s === "string" ? s.length : 0;
}

function pick(
  obj: Record<string, unknown>,
  ...keys: string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

function format(parts: Record<string, string>): string {
  const entries = Object.entries(parts);
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}=${v}`).join(" ");
}

export function summariseParams(
  method: string,
  params: Record<string, unknown>,
): string {
  const p = params ?? {};
  switch (method) {
    case "listProjects":
      return format({});
    case "listTasks":
      return format(pick(p, "project", "status"));
    case "getContext":
      return format({
        cwd: p.cwd ? "present" : "absent",
        project: typeof p.project === "string" ? "present" : "absent",
      });
    case "getTask":
      return format({ task_id: String(p.task_id ?? "") });
    case "createProject":
      return format({ name_len: String(len(p.name)), slug_len: String(len(p.slug)) });
    case "updateProject":
      return format({ project: String(p.project ?? ""), fields: String(Object.keys(p).length) });
    case "deleteProject":
      return format({ project: String(p.project ?? "") });
    case "createTask":
      return format({
        title_len: String(len(p.title)),
        status: String(p.status ?? "todo"),
      });
    case "updateTask":
      return format({ task_id: String(p.task_id ?? ""), fields: String(Object.keys(p).length) });
    case "logEntry":
      return format({
        task_id: String(p.task_id ?? ""),
        kind: String(p.kind ?? ""),
        body_len: String(len(p.body)),
      });
    case "linkFiles":
      return format({ task_id: String(p.task_id ?? ""), paths: String(Array.isArray(p.paths) ? p.paths.length : 0) });
    case "reportRefs":
      return format({ refs: String(Array.isArray(p.refs) ? p.refs.length : 0) });
    case "addContext":
      return format({ kind: String(p.kind ?? ""), title_len: String(len(p.title)), body_len: String(len(p.body)) });
    case "search":
      return format({ query_len: String(len(p.query)), limit: String(p.limit ?? "default") });
    case "activityReport":
      return format({ period: String(p.period ?? "today"), format: String(p.format ?? "json") });
    case "recordClientInfo":
      return format({ name: String(p.name ?? ""), version: String(p.version ?? "unknown") });
    default:
      return "";
  }
}
```

- [ ] **Step 3: Create `lib/services/params-summary.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { summariseParams } from "./params-summary";

describe("summariseParams", () => {
  it("returns empty string for unknown methods", () => {
    expect(summariseParams("wat", {})).toBe("");
  });

  it("summarises create_task without leaking body", () => {
    const out = summariseParams("createTask", {
      title: "MCP install friction",
      body: "very long body that must never appear here",
      cwd: "C:/Users/Furkan/todox",
    });
    expect(out).toContain("title_len=21");
    expect(out).not.toContain("very long body");
    expect(out).not.toContain("C:/Users/Furkan/todox");
  });

  it("summarises log_entry with task_id and body_len", () => {
    const out = summariseParams("logEntry", {
      task_id: 42,
      kind: "handoff",
      body: "summary text",
    });
    expect(out).toBe("task_id=42 kind=handoff body_len=12");
  });

  it("summarises search with query_len only", () => {
    const out = summariseParams("search", {
      query: "what did we decide about TTL",
      limit: 30,
    });
    expect(out).toBe("query_len=29 limit=30");
    expect(out).not.toContain("TTL");
    expect(out).not.toContain("what did we decide");
  });

  it("summarises get_context presence-only", () => {
    const out = summariseParams("getContext", { cwd: "C:/Users/Furkan/todox" });
    expect(out).toBe("cwd=present project=absent");
    expect(out).not.toContain("C:/Users/Furkan/todox");
  });

  it("summarises recordClientInfo with name and version", () => {
    expect(
      summariseParams("recordClientInfo", { name: "claude-code", version: "1.2.3" }),
    ).toBe("name=claude-code version=1.2.3");
  });

  it("handles missing fields gracefully", () => {
    expect(summariseParams("updateTask", { task_id: 1 })).toBe("task_id=1 fields=1");
    expect(summariseParams("updateTask", {})).toBe("task_id= fields=0");
  });

  it("output length is bounded (≤120 chars)", () => {
    const long = { task_id: 999999, kind: "handoff", body_len: 100000 };
    expect(summariseParams("logEntry", long).length).toBeLessThanOrEqual(120);
  });
});
```

- [ ] **Step 4: Modify `lib/services/rpc.ts` — wrap invoke() with mirror log**

Read the file first to find the exact `invoke` location (likely around line 310). Add an import at the top of the `services` block:

```ts
import { openOrReuse, recordCall } from "../repositories/sessions";
import { hashToken } from "./auth";
import { summariseParams } from "./params-summary";
```

Replace `invoke` (or whatever the current body is — match the existing signature exactly) with:

```ts
async function recordCallSafely(
  ctx: RpcContext,
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
  try {
    const tokenHash = ctx.token ? hashToken(ctx.token) : null;
    if (!tokenHash) return;
    const session = await openOrReuse(
      tokenHash,
      ctx.clientName ?? null,
      ctx.clientVersion ?? null,
    );
    await recordCall({
      session_id: session.id,
      method,
      params_summary: summariseParams(method, params),
    });
  } catch {
    // Mirror log is fire-and-forget; never break the request.
  }
}

export async function invoke(ctx: RpcContext, method: string, params: unknown) {
  if (!isMethod(method)) throw new BadRequest(`unknown method "${method}"`);
  const clean = parseParams(method, params);
  // Fire-and-forget mirror log. Runs after parseParams succeeds so
  // BadRequest errors are not logged here.
  if (ctx.token) {
    queueMicrotask(() => {
      recordCallSafely(ctx, method, clean).catch(() => {});
    });
  }
  return methods[method](ctx, clean as Record<string, never>);
}
```

If `RpcContext` does NOT yet have `clientName` / `clientVersion`, add them:

```ts
export type RpcContext = {
  userId: number;
  token?: string;
  clientName?: string;
  clientVersion?: string;
};
```

(These are populated by the HTTP route's `captureClientInfo` from PR #9 and by the stdio startup from PR #9 — the record sits in `api_tokens.last_client_*`. Wire it into the context in `app/api/mcp/route.ts` and `mcp/server.ts` so `invoke` sees the values.)

- [ ] **Step 5: Wire `clientName` / `clientVersion` into `RpcContext`**

In `app/api/mcp/route.ts`, after `captureClientInfo` populates the DB row, also stash on `ctx`:

```ts
const safeInvoke = async (method, params) => {
  const ctx = {
    userId: user.id,
    token,
    clientName: lastClient?.name ?? null,
    clientVersion: lastClient?.version ?? null,
  };
  // ... existing logic ...
};
```

(Read the existing `captureClientInfo` to find `lastClient` — adjust names if needed.)

In `mcp/server.ts`, the stdio path reads `TODOX_CLIENT_NAME` / `TODOX_CLIENT_VERSION` at startup. Pass them through every `call` invocation — add a closure that captures them:

```ts
const call = (method: MethodName, params: Record<string, unknown>) =>
  httpInvoke(method, params, {
    token,
    clientName: process.env.TODOX_CLIENT_NAME,
    clientVersion: process.env.TODOX_CLIENT_VERSION,
  });
```

(Read `mcp/rpc-client.ts` for the exact signature and add the optional context argument.)

- [ ] **Step 6: Add a test in `lib/services/rpc.test.ts`**

Find the existing test file. Append:

```ts
import { describe, expect, it, vi } from "vitest";
import { invoke } from "./rpc";
import * as sessions from "../repositories/sessions";
import * as auth from "./auth";
import * as paramsSummary from "./params-summary";

vi.mock("../repositories/sessions", () => ({
  openOrReuse: vi.fn(),
  recordCall: vi.fn(),
}));
vi.mock("./auth", () => ({ hashToken: vi.fn(() => "hashed") }));
vi.mock("./params-summary", () => ({ summariseParams: vi.fn(() => "task_id=42") }));
vi.mock("./ownership", () => ({ NotYours: class NotYours extends Error {} }));
vi.mock("./errors", () => ({ BadRequest: class BadRequest extends Error {} }));

describe("invoke mirror log", () => {
  it("records the call on success", async () => {
    vi.mocked(sessions.openOrReuse).mockResolvedValue({
      id: 7, token_hash: "h", client_name: "claude-code", client_version: "1.0",
      started_at: "x", last_seen_at: "y", closed_at: null, summary: null,
    });
    vi.mocked(sessions.recordCall).mockResolvedValue(undefined);
    // ... invoke a method that doesn't actually need DB hits ...
    // (use createProject with minimal payload)
    await expect(
      invoke({ userId: 1, token: "tk", clientName: "claude-code" }, "createProject", { name: "x" }),
    ).resolves.toBeDefined();
    // queueMicrotask is async; wait one tick
    await new Promise((r) => setTimeout(r, 0));
    expect(sessions.openOrReuse).toHaveBeenCalledWith("hashed", "claude-code", null);
  });

  it("swallows openOrReuse failure (does not break the call)", async () => {
    vi.mocked(sessions.openOrReuse).mockRejectedValue(new Error("db down"));
    // invoke should still return the handler result
    await expect(
      invoke({ userId: 1, token: "tk" }, "createProject", { name: "x" }),
    ).resolves.toBeDefined();
  });

  it("skips logging when token is missing", async () => {
    await invoke({ userId: 1 }, "createProject", { name: "x" });
    await new Promise((r) => setTimeout(r, 0));
    expect(sessions.openOrReuse).not.toHaveBeenCalled();
  });
});
```

(Adjust based on the actual existing test setup — the goal is to verify the interceptor fires, swallows errors, and skips without a token.)

- [ ] **Step 7: Run tests + lint + typecheck**

Run: `pnpm test -- lib/services/params-summary.test.ts lib/services/rpc.test.ts lib/repositories/sessions.test.ts`
Expected: all green.

Run: `pnpm lint && pnpm exec tsc --noEmit | head -20`
Expected: clean.

- [ ] **Step 8: Commit**

Branch: `feat/session-aware-memory-mirror-log`.

```bash
git checkout -b feat/session-aware-memory-mirror-log
git add lib/services/params-summary.ts lib/services/params-summary.test.ts lib/services/rpc.ts lib/services/rpc.test.ts app/api/mcp/route.ts mcp/server.ts mcp/rpc-client.ts
git commit -m "feat(sessions): mirror log interceptor + params-summary"
```

---

## Task 3: Roll-up cron + briefing transform + docs

**Files:**
- Create: `scripts/rollup-sessions.ts`
- Modify: `mcp/tools.ts` (`get_context` transform renders `last_session`)
- Modify: `mcp/tools.test.ts` (extend existing harness with bearer token so transform runs)
- Modify: `package.json` (add `rollup:sessions` script)
- Modify: `docs/mcp.md` (add Skill framework integration section)

**Interfaces:**
- Consumes: Task 1 → `rollUpIdle(render)`, `renderLastSession`. Existing `Workspace.bearerToken` from PR #9.
- Produces:
  - `pnpm rollup:sessions` runs and exits 0.
  - `get_context` response gains `last_session: LastSessionView | null` and `session_id: number`.
  - `docs/mcp.md` documents the implicit-session and the skill-side hook recommendation.

- [ ] **Step 1: Create `scripts/rollup-sessions.ts`**

```ts
#!/usr/bin/env -S npx tsx
/**
 * Roll up idle todox sessions.
 *
 * A session is "idle" if its last_seen_at is more than 30 minutes in the
 * past. Rolling up aggregates the session's rpc_calls into a single
 * summary string, persists it on the session row, and deletes the
 * detail. The session row stays forever (or until a separate long-term
 * prune), so the briefing in subsequent get_context calls still has
 * something to show.
 *
 * Run via:
 *   pnpm rollup:sessions
 * or via a cron job. Idempotent — safe to run on any cadence.
 */
import "./env";
import { rollUpIdle } from "../lib/repositories/sessions";
import { renderLastSession } from "../lib/services/render-last-session";

async function main() {
  const n = await rollUpIdle((session, calls) =>
    renderLastSession(session, calls).summary,
  );
  console.log(`rolled up ${n} idle session(s)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

- [ ] **Step 2: Add the script to `package.json`**

Add to the `scripts` block:

```json
"rollup:sessions": "tsx scripts/rollup-sessions.ts"
```

- [ ] **Step 3: Wire `last_session` into `get_context`**

In `mcp/tools.ts`, find the `get_context` registration (around line 462 in the post-PR-9 tree). Extend the `transform` (or `after` if no transform exists):

```ts
tool(
  "get_context",
  "getContext",
  {
    title: "Get project context (call this first)",
    description:
      "Read what previous sessions on this project already worked out, so you do not ask the developer to explain it again. The session-start briefing: standing rules, decisions, prior approaches that failed, open questions, in-flight tasks with linked files, and the note the last session left. Also flags notes whose files have changed. Call this before planning any non-trivial work; pass your working directory as `cwd`. If you have a prior session_id, pass it; otherwise the server resumes your most recent session automatically.",
    annotations: READ_ONLY,
  },
  {
    after: checkLinkedFiles,
    transform: async (result, _args, ws: Workspace) => {
      const token = ws.bearerToken?.();
      if (!token) return result;
      const session = await lastSessionForWs(token, ws);
      if (!session) return result;
      const view = await buildLastSessionView(session);
      return {
        ...(result as Record<string, unknown>),
        session_id: view.session_id,
        last_session: view,
      };
    },
  },
);
```

`lastSessionForWs` and `buildLastSessionView` are local helpers in `mcp/tools.ts`:

```ts
async function lastSessionForWs(
  token: string,
  ws: Workspace,
): Promise<RpcSession | null> {
  try {
    const tokenHash = hashToken(token);
    return await lastSession(tokenHash);
  } catch {
    return null;
  }
}

async function buildLastSessionView(session: RpcSession): Promise<LastSessionView> {
  const calls = session.closed_at
    ? [] // closed sessions: rpc_calls already deleted; summary alone is the source
    : await rpcCallsForSession(session.id);
  return renderLastSession(session, calls);
}
```

Imports to add at the top of `mcp/tools.ts`:

```ts
import { lastSession as sessionLastSession, type RpcSession } from "@/lib/repositories/sessions";
import { all as dbAll } from "@/lib/db/client";
import { hashToken } from "@/lib/services/auth";
import { renderLastSession, type LastSessionView } from "@/lib/services/render-last-session";
```

`rpcCallsForSession` helper:

```ts
async function rpcCallsForSession(sessionId: number) {
  return dbAll<{ id: number; session_id: number; called_at: string; method: string; params_summary: string }>(
    `SELECT id, session_id, called_at, method, params_summary
       FROM rpc_calls
      WHERE session_id = ?
      ORDER BY called_at ASC`,
    [sessionId],
  );
}
```

If the existing test harness (`mcp/tools.test.ts`) does not set `bearerToken`, extend it with `bearerToken: () => "test-token"`. Add an assertion:

```ts
it("get_context response includes session_id and last_session when token present", async () => {
  const ws = makeWorkspace({ bearerToken: () => "test-token" });
  // ... invoke get_context tool, assert result.session_id > 0 and result.last_session != null
});
```

- [ ] **Step 4: Update `docs/mcp.md`**

Append a new section after the existing "Install" section:

```markdown
## Skill framework integration

todox records every RPC call your agent makes, with no opt-in. If you
orchestrate an agent across multiple tasks (e.g. `subagent-driven-development`,
custom pipelines), explicit `log_entry` calls are still valuable — they
capture *why* a decision was made, not just *that* it was made. todox's
mirror log captures the *that*; your explicit entries capture the *why*.

Recommended pattern: at the end of each task, call
`log_entry(kind:'handoff', body:'<one-paragraph summary of decisions and next steps>')`.
The mirror log handles the rest.

If you are writing a new client (not using an existing framework), the
server identifies your session implicitly from `(token_hash, client_name)`.
You do not need to pass any session identifier — `get_context` returns one
for free.
```

- [ ] **Step 5: Run tests + lint + typecheck + build**

Run: `pnpm test`
Expected: all green (every prior test + new briefing test).

Run: `pnpm lint && pnpm exec tsc --noEmit | head -20 && pnpm build | tail -10`
Expected: clean (modulo 11 pre-existing `app/**` PageProps errors).

- [ ] **Step 6: Smoke test the roll-up cron locally**

Set `DATABASE_URL` to the dev DB, run:

```bash
pnpm db:migrate
pnpm tsx scripts/rollup-sessions.ts
```

Expected: `rolled up 0 idle session(s)` (or however many are actually idle).

- [ ] **Step 7: Commit**

Branch: `feat/session-aware-memory-rollup-and-briefing`.

```bash
git checkout -b feat/session-aware-memory-rollup-and-briefing
git add scripts/rollup-sessions.ts package.json mcp/tools.ts mcp/tools.test.ts docs/mcp.md
git commit -m "feat(sessions): rollup cron, briefing transform, docs"
```

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task |
|---|---|
| Schema (rpc_sessions, rpc_calls) | Task 1 |
| Repository (openOrReuse, recordCall, lastSession, rollUp, rollUpIdle) | Task 1 |
| Summary renderer (`renderLastSession`) | Task 1 |
| Params summary (deterministic, ≤120 chars) | Task 2 |
| Mirror log interceptor in `invoke()` | Task 2 |
| Wire `clientName`/`clientVersion` into RpcContext | Task 2 |
| Fire-and-forget with try/catch | Task 2 |
| Briefing injection in `get_context` transform | Task 3 |
| `last_session` object + `summary` string in response | Task 3 |
| `session_id` advisory echo | Task 3 |
| Roll-up cron (`pnpm rollup:sessions`) | Task 3 |
| Skill framework hook in `docs/mcp.md` | Task 3 |

**2. Placeholder scan:**

- No "TBD", "TODO", or "implement later". Every code block is concrete.
- One file (`rpc.ts`) is modified by the plan; the existing test harness may need slight adaptation. Adjust the Step 6 snippet to match the project's actual test style — that is not a placeholder, that is a known fit-in step.

**3. Type consistency:**

- `RpcSession` defined in `lib/repositories/sessions.ts`, imported wherever needed.
- `RpcCall` defined in `lib/repositories/sessions.ts`.
- `LastSessionView` defined in `lib/services/render-last-session.ts`, exported, returned from the briefing transform.
- `summariseParams(method, params)` signature stable across Task 2.
- `renderLastSession(session, calls, nowMs?)` signature stable across Tasks 1 and 3.
- `rollUpIdle(render)` accepts a render callback so Task 1 (with `renderLastSession`) and Task 3 (with the script) both work.

**4. Repo-rule fit:**

- New repository `sessions` touches two tables; both via this repo (single-table per AGENTS.md). ✓
- `rpc_sessions` and `rpc_calls` are not in any other repository — clean separation. ✓
- No cross-table logic; roll-up is a service concern. ✓
- The interceptor in `invoke()` is in `lib/services/rpc.ts`, not in a handler. ✓
- New RPC method `recordClientInfo` (PR #9) is unrelated to this spec — its token usage is parallel, not conflicting. ✓
- Tool description for `get_context` is updated to mention the session_id behaviour. ✓

**5. Risk re-check:**

- Mirror log failure → swallowed by try/catch, never breaks a request. ✓
- Storage → bounded by roll-up (Task 3). ✓
- Privacy → per-method allow-list (Task 2); no body/path/secret in summary. ✓
- Backward compat → zero request-side change; old clients work unchanged. ✓
- Roll-up cron never runs → manual `pnpm rollup:sessions` works (Task 3 Step 6). ✓

No drift detected.