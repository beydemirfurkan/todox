# Session-Aware Memory MCP — Design Spec


> **Historical record, not the current architecture.** Dated 12 August 2026. Kept
> because it is what was decided and why, which is the point of this project —
> not because it describes how todox works now. It was written against a
> serverless deployment on a managed Postgres with a platform cron; todox runs
> as a container beside its own database, and the driver, the deployment and
> the scheduling assumptions here are all out of date. The design was approved
> and never built. Read it as an argument, and re-cost it before acting on it.

**Date:** 2026-08-12
**Status:** Approved (brainstorming complete, awaiting user review of written spec)

## Problem

Skill-driven agent sessions bypass cross-session persistent memory. When an agent is bootstrapped by a skill stack (superpowers, claude-code skills, custom), it has its own within-task ledger (`.superpowers/sdd/progress.md`) and forgets to call the configured memory MCP (`mcp__todox__log_entry`). The four-line contract in `~/.config/opencode/AGENTS.md` is loaded but not followed.

Empirical evidence from the MCP install friction session today: 3 PRs merged, only 1 had log_entry calls (`Task #42`, 4 entries). The other 2 PRs left no audit trail.

This affects every project whose agent uses both a skill framework and a memory MCP. It is not a todox-specific bug — it is a class of problem that affects any memory tool.

## Goal

Make every agent session reconstructible from server-side state, regardless of whether the agent remembers to call `log_entry`. Zero cooperation required from agent or skill framework.

## Non-Goals

- Replacing `log_entry` with mandatory mirroring — explicit entries are still valuable for semantic content.
- Replicating full RPC params — privacy + storage cost. Method + key fields only.
- Tracking multi-MCP sessions across different memory tools. Single MCP server = single session model.
- Forcing every existing client to upgrade — backward compatibility is required.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                       AGENT                              │
│  tool: get_context(cwd, model, [session_id])              │
│        ↓ returns { ..., session_id, last_session_summary }│
│  tool: create_task(..., session_id)                       │
│  tool: log_entry(task_id, kind, body, session_id)          │
│  ...                                                      │
└──────────────────────────────────────────────────────────┘
                          ↓
                  ┌──────────────────┐
                  │  /api/rpc        │
                  │  1. authenticate │
                  │  2. parseParams  │
                  │  3. invoke       │
                  │  4. recordCall ── fire-and-forget (try/catch)
                  │  5. echo session_id
                  └──────────────────┘
                          ↓
                  ┌──────────────────┐
                  │  rpc_sessions    │  ←── new table (this spec)
                  │  rpc_calls       │  ←── new table (this spec)
                  └──────────────────┘
```

The interceptor is a thin wrapper around `lib/services/rpc.ts:invoke()`. It does not change handler signatures; it only records what handlers see.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Scope | todox implements; MCP standard proposal follows as separate track |
| Session identification | Server-driven implicit, keyed on `(token_hash, client_name)` — no client cooperation |
| Mirror log scope | Method + key fields only (no full params, no body content) |
| Briefing format | Structured `last_session` object + summary string |
| Retention | Active sessions hold detailed calls; idle > 30min rolls up to summary, drops detail. Summary retained long-term (subject to a separate prune policy; default: indefinite) |
| Backward compat | Zero API change. Server identifies sessions from auth + client_info alone. |
| Skill framework hook | Document in `docs/mcp.md` + reference PR to `superpowers:subagent-driven-development` |

## Schema

Two new tables in `lib/db/schema.ts`. Both follow the existing `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` migration pattern.

```sql
-- Active + recently-closed sessions.
-- Detailed rpc_calls rows are deleted on roll-up; the `summary` column
-- holds the rendered briefing string for the closed session and is the
-- only surviving detail after 30min idle.
CREATE TABLE rpc_sessions (
  id             SERIAL PRIMARY KEY,
  token_hash     TEXT NOT NULL,
  client_name    TEXT,
  client_version TEXT,
  started_at     TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  closed_at      TEXT,         -- NULL while active, set on roll-up
  summary        TEXT          -- rendered briefing string, set on roll-up
);
CREATE INDEX idx_sessions_open  ON rpc_sessions(token_hash, client_name) WHERE closed_at IS NULL;
CREATE INDEX idx_sessions_token ON rpc_sessions(token_hash, last_seen_at DESC);

-- Detailed per-call audit. Cascade-deleted when its session rolls up.
CREATE TABLE rpc_calls (
  id             SERIAL PRIMARY KEY,
  session_id     INTEGER NOT NULL REFERENCES rpc_sessions(id) ON DELETE CASCADE,
  called_at      TEXT NOT NULL,
  method         TEXT NOT NULL,
  params_summary TEXT NOT NULL
);
CREATE INDEX idx_calls_session ON rpc_calls(session_id, called_at DESC);
```

Existing `api_tokens.last_client_*` columns stay for backward compatibility with anything reading them; new write paths go through `rpc_sessions`. No migration removes them.

## Component design

### `lib/repositories/sessions.ts` (new)

Repository methods, single-table per AGENTS.md:

```ts
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
 * Server-driven: the caller never passes a session_id in. Same token
 * used by two different MCP clients (different client_name) gets two
 * distinct sessions.
 */
export async function openOrReuse(
  tokenHash: string,
  clientName: string | null,
  clientVersion: string | null,
): Promise<RpcSession>;

/** Append a call record. Fire-and-forget on the caller side. */
export async function recordCall(input: {
  session_id: number;
  method: string;
  params_summary: string;
}): Promise<void>;

/** Most recent session (open or closed-with-summary) for this token. */
export async function lastSession(tokenHash: string): Promise<RpcSession | null>;

/**
 * Roll up a session: aggregate rpc_calls into a summary string, persist
 * the summary on the session row, mark closed_at, delete rpc_calls.
 * Triggered by background cron when last_seen_at < now - 30min.
 */
export async function rollUp(sessionId: number): Promise<void>;

/** Cron entry point: roll up every session idle > 30 minutes. */
export async function rollUpIdle(): Promise<number>;
```

### `lib/services/params-summary.ts` (new)

Pure function: `(method: string, params: unknown) => string`. Per-method summary rules:

| Method | Summary |
|---|---|
| `create_task` | `project_slug=… title_len=N status=…` |
| `update_task` | `task_id=N fields=N` |
| `log_entry` | `task_id=N kind=… body_len=N` |
| `add_context` | `kind=… title_len=N body_len=N scope=…` |
| `create_project` | `name=… slug=…` |
| `update_project` | `project=… fields=N` |
| `delete_project` | `project=…` |
| `link_files` | `task_id=N paths=N` |
| `search` | `query="…" limit=N` |
| `list_tasks` | `project=… status=…` |
| `get_context` | `cwd=present project=…` |
| everything else | `method-only` (no fields) |

No body content, no full paths. Output is deterministic, ≤120 chars.

### `lib/services/rpc.ts:invoke()` change

After `parseParams()` succeeds, fire-and-forget record:

```ts
export async function invoke(ctx: RpcContext, method: string, params: unknown) {
  if (!isMethod(method)) throw new BadRequest(`unknown method "${method}"`);
  const clean = parseParams(method, params);
  // Mirror log: fire-and-forget, never breaks the call
  if (ctx.token) {
    queueMicrotask(() => {
      recordCallSafely(ctx, method, clean).catch(() => {});
    });
  }
  return methods[method](ctx, clean as Record<string, never>);
}
```

`parseParams()` failures (unknown method, schema rejection) intentionally do **not** log to rpc_calls — they happen before the mirror-log interceptor runs. BadRequest surfaces to the client as a 400; the client's own HTTP logs are the audit trail for invalid calls. Logging them in rpc_calls would mix valid and invalid traffic without an easy way to filter.

`recordCallSafely` resolves session_id (reuse or mint), inserts the rpc_calls row. Errors are swallowed because the user-visible response is the handler's return value, not the audit row.

### `lib/services/rpc.ts` handler context

`RpcContext.token: string | undefined` already exists from PR #9 (`recordClientInfo` needs it). The new mirror-log interceptor reuses the same token; **no `session_id` field on `RpcContext`** — server resolves sessions implicitly from `(token_hash, client_name)`.

### `mcp/tools.ts:get_context` briefing

The handler returns the briefing object; a transform injects `last_session`:

```ts
tool("get_context", "getContext", { ... }, {
  after: checkLinkedFiles,
  transform: async (result, _args) => {
    const token = ws.bearerToken();
    if (!token) return result;
    const last = await lastSession(hashToken(token));
    if (!last) return result;
    return { ...result, last_session: renderLastSession(last) };
  },
});
```

`last_session` object shape:

```ts
{
  session_id: number;
  client_name: string | null;
  started_at: string;       // ISO
  ended_at: string | null;   // null if still active
  total_calls: number;
  method_counts: { get_context: 3, create_task: 1, log_entry: 7, ... };
  summary: string;          // pre-rendered narrative, single-line
}
```

`summary` string format:

```
Last session by claude-code 1.2.3 (Aug 12, 14:00 → 14:18, 18min, 47 calls):
  3× get_context, 1× create_task (#42 "MCP install friction"),
  7× log_entry (5 handoff, 2 dead_end). Last activity: 14:18.
```

For active sessions, `ended_at` is null and "Last activity" replaces "→". If the prior session has zero activity, `summary` degrades to a single line.

### `lib/services/sessions.ts:openOrReuse` semantics

- Lookup most-recent session where `token_hash = $1 AND client_name = $2 AND closed_at IS NULL`. If found, update `last_seen_at`, return.
- Else INSERT a new row with `started_at = last_seen_at = now()`, return.

Multiple clients using the same token (different `client_name` values) get distinct sessions naturally. A single client that crashes and restarts every 25 minutes gets a fresh session each time — that is the intended behaviour, not a bug.

### Roll-up (replaces 30-day retention)

When a session's `last_seen_at` is more than 30 minutes in the past:

1. Compute aggregate stats from `rpc_calls`: `total_calls`, `method_counts`, `first_at`, `last_at`.
2. Render the `summary` string (same format as the briefing).
3. `UPDATE rpc_sessions SET closed_at = last_seen_at, summary = <rendered>`.
4. `DELETE FROM rpc_calls WHERE session_id = <id>` (cascade).
5. The session row stays forever (or until a separate long-term prune), holding only the summary.

This is **additive safety** — even if `log_entry` was never called, the mirror log has every method call, and the rolled-up summary reconstructs the session's intent from method counts.

### Backward compat

Zero client-side change. Server identifies the session purely from `(token_hash, client_name)`. Old clients (no `session_id` param, no `Mcp-Session-Id` header) work unchanged.

The only response change is the addition of `session_id` (advisory echo) and `last_session` to `get_context`. Both fields are additive; old clients ignore them.

## API contract changes

Zero request-side changes. **All clients work unchanged.**

### `get_context` response

```diff
 {
   project: { ... },
   project_context: [...],
   open_tasks: [...],
   recent_entries: [...],
   stale_refs: [...],
+  session_id: number,           // server-minted; advisory
+  last_session: {              // null if no prior session
+    session_id: number,
+    client_name: string | null,
+    started_at: string,
+    ended_at: string | null,
+    total_calls: number,
+    method_counts: { ... },
+    summary: string,
+  } | null,
 }
```

### Every other response

```diff
 {
+  session_id: number,           // server-minted; advisory echo
 }
```

The `session_id` field is additive; old clients ignore it.

## Roll-up cron

A new `scripts/rollup-sessions.ts`:

```ts
import "./env";
import { rollUpIdle } from "../lib/repositories/sessions";
const n = await rollUpIdle();
console.log(`rolled up ${n} idle sessions`);
process.exit(0);
```

Add to `package.json` scripts:

```json
"rollup:sessions": "tsx scripts/rollup-sessions.ts"
```

`rollUpIdle()` finds every session where `last_seen_at < now - 30min AND closed_at IS NULL`, computes the summary, persists it, deletes the rpc_calls rows.

Vercel cron job (or manual `pnpm rollup:sessions` daily) keeps the table bounded. Document in README — no automatic scheduling on first deploy.

## Skill framework hook (Layer 3)

`docs/mcp.md` gains a section:

> ### Skill framework integration
>
> todox records every RPC call your agent makes, with no opt-in. If you orchestrate an agent across multiple tasks (e.g. `subagent-driven-development`, custom pipelines), explicit `log_entry` calls are still valuable — they capture *why* a decision was made, not just *that* it was made. todox's mirror log captures the *that*; your explicit entries capture the *why*.
>
> Recommended pattern: at the end of each task, call `log_entry(kind:'handoff', body:'<one-paragraph summary of decisions and next steps>')`. The mirror log handles the rest.

Reference impl: PR to `superpowers/skills/subagent-driven-development` adding `mcp__todox__log_entry` at task completion. Out of scope for this spec.

Reference impl: PR to `superpowers/skills/subagent-driven-development` adding `mcp__todox__log_entry` at task completion. Out of scope for this spec.

## MCP standard proposal (separate track)

`docs/superpowers/specs/mcp-session-memory.md` will propose to the MCP working group:

1. **Standard `Mcp-Session-Id` header** for HTTP transports — vendor-agnostic, opt-in.
2. **Server-side mirror log** as a recommended pattern for any stateful MCP server — surfaces "agent did X, server saw Y" visibility without client cooperation.
3. **Auto-briefing** as a recommended practice for context-carrying tools — server returns summary of prior session in `initialize` response or first tool call.
4. **Session lifecycle contract** — server rolls up idle sessions to summary rows; clients do not need to track session IDs explicitly.

Submitted as a PR to `modelcontextprotocol/modelcontextprotocol` after todox ships the reference implementation. Out of scope for this spec.

The todox implementation does **not** depend on the standard being adopted — it works today with implicit `(token_hash, client_name)` sessions, and explicit `Mcp-Session-Id` adoption later becomes additive optimisation.

## Testing strategy

### Unit

- `lib/services/params-summary.test.ts` — each method has a deterministic summary; secrets never appear.
- `lib/repositories/sessions.test.ts` — `openOrReuse` creates/mints correctly; `recordCall` is fire-and-forget; `rollUp` produces correct summary; `rollUpIdle` selects only stale sessions.
- `lib/services/render-last-session.test.ts` — summary string formats correctly for active vs closed sessions.
- `lib/services/rpc.test.ts` — `invoke` records the call even when handler throws; `queueMicrotask` does not block the response.

### Integration

- `pnpm smoke:mcp` — already covers `initialize` + `tools/list` + `tools/call(get_context)`. Add an assertion that the response includes `session_id > 0` and that `last_session` is non-null after a brief session (start a session, make a `log_entry`, observe the briefing).

### Roll-up

- A test inserts a fake session with `last_seen_at` 1 hour in the past and 5 rpc_calls rows, calls `rollUp`, asserts the session has `closed_at`, `summary`, and zero rpc_calls rows.

### Backward compat

- A test sends a `get_context` request with no `session_id` param (it was never added). Asserts response includes `session_id` and `last_session` is null on first call.

## Risk analysis

| Risk | Mitigation |
|---|---|
| Mirror log write fails on every call | Fire-and-forget with try/catch; never breaks the response |
| Storage grows unbounded | Roll-up at 30min idle drops rpc_calls; only summary row remains per closed session |
| Privacy leak via summary | Per-method allow-list; never include body, path, or secret fields |
| `api_tokens.last_client_*` overlap with `rpc_sessions.client_*` | Two sources of truth; old readers keep working. Future task can deprecate one. |
| Roll-up cron never runs | Manual `pnpm rollup:sessions` works; Vercel cron documented |
| Same token, two simultaneous Claude Code windows | Distinct sessions because MCP `clientInfo.name` includes window/process identity in some clients; if not, sessions merge, mirror log merges too — the briefing just shows combined activity. Acceptable. |

## Migration

Three atomic commits, all additive:

1. `feat(sessions): rpc_sessions + rpc_calls tables + repo` — schema + repository + summary renderer.
2. `feat(sessions): mirror log interceptor` — `rpc.ts:invoke()` change + `params-summary.ts`.
3. `feat(sessions): roll-up cron + briefing + last_session field` — `scripts/rollup-sessions.ts` + briefing transform.

Each commit runs `pnpm lint && pnpm test && pnpm exec tsc --noEmit`. DB migration applied via `pnpm db:migrate`.

## Acceptance criteria

- [x] Spec reviewed by user (this document, after brainstorming revision)
- [ ] Plan written via writing-plans skill (next step)
- [ ] Plan reviewed and approved
- [ ] 3 atomic commits land on `feat/session-aware-memory`
- [ ] `pnpm smoke:mcp` shows `session_id` and `last_session` after a brief session
- [ ] Old client (no API change required) works unchanged
- [ ] Roll-up script tested against a synthetic dataset with `last_seen_at` 1h in past
- [ ] `docs/mcp.md` updated with skill framework integration section
- [ ] MCP standard proposal drafted at `docs/superpowers/specs/mcp-session-memory.md`

## Out of scope (explicit)

- Vercel cron for automatic roll-up (manual `pnpm rollup:sessions` for now).
- Multi-MCP session sharing (single MCP = single session model).
- Full params mirroring (privacy + storage cost).
- Removing existing `api_tokens.last_client_*` columns (backward compat).
- Submitting the MCP standard PR (separate, after this ships).
- Removing `last_client_*` columns from `api_tokens`.

## Revision log

- 2026-08-12 (initial): explicit session_id param, 30-day TTL, inline `last_session_summary` string.
- 2026-08-12 (revised): implicit server-driven session_id from `(token_hash, client_name)`, active+roll-up retention model, structured `last_session` object with embedded `summary` string. Zero request-side API change.