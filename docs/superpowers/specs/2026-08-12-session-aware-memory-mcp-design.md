# Session-Aware Memory MCP — Design Spec

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
| Session identification | Server-generated, explicit `session_id` returned by `get_context`; client passes back |
| Mirror log scope | Method + key fields only (no full params, no body content) |
| Briefing format | Inline string in `last_session_summary` |
| Retention | 30 days, then pruned by background job |
| Backward compat | Auto-mint session_id when client does not pass one |
| Skill framework hook | Document in `docs/mcp.md` + reference PR to `superpowers:subagent-driven-development` |

## Schema

Two new tables in `lib/db/schema.ts`. Both follow the existing `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` migration pattern.

```sql
CREATE TABLE rpc_sessions (
  id              SERIAL PRIMARY KEY,
  token_hash      TEXT NOT NULL,
  client_name     TEXT,
  client_version  TEXT,
  started_at      TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  closed_at       TEXT
);
CREATE INDEX idx_sessions_token ON rpc_sessions(token_hash, last_seen_at DESC);
CREATE INDEX idx_sessions_open  ON rpc_sessions(closed_at) WHERE closed_at IS NULL;

CREATE TABLE rpc_calls (
  id              SERIAL PRIMARY KEY,
  session_id      INTEGER NOT NULL REFERENCES rpc_sessions(id) ON DELETE CASCADE,
  called_at       TEXT NOT NULL,
  method          TEXT NOT NULL,
  params_summary  TEXT NOT NULL
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
};

export type RpcCall = {
  id: number;
  session_id: number;
  called_at: string;
  method: string;
  params_summary: string;
};

/** Find an open session for (token_hash, client_name) or mint a new one. */
export async function openOrReuse(
  tokenHash: string,
  clientName: string | null,
  clientVersion: string | null,
): Promise<RpcSession>;

/** Mark a session as closed. */
export async function close(sessionId: number, at: string): Promise<void>;

/** Append a call record. Fire-and-forget on the caller side. */
export async function recordCall(input: {
  session_id: number;
  method: string;
  params_summary: string;
}): Promise<void>;

/** Summarise the most recent closed or open session for a token. */
export async function lastSessionSummary(tokenHash: string): Promise<string | null>;

/** Prune calls/sessions older than 30 days. */
export async function prune(beforeISO: string): Promise<void>;
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

Extend `RpcContext` with `token: string | undefined`. Already done in PR #9 (`recordClientInfo` needs it). Verify and add `session_id?: number`.

### `mcp/tools.ts:get_context` briefing

The handler returns the briefing object; a transform injects `last_session_summary`:

```ts
tool("get_context", "getContext", { ... }, {
  after: checkLinkedFiles,
  transform: async (result, _args) => {
    const token = ws.bearerToken();
    if (!token) return result;
    const summary = await lastSessionSummary(hashToken(token));
    if (!summary) return result;
    return { ...result, last_session_summary: summary };
  },
});
```

Briefing string format:

```
Last session by {client_name} {client_version} ({started_at} → {ended_at or "active"}, {wall_min}min, {total_calls} calls):
  {top_3_method_counts}, {task_count_for_create_task}× create_task {ids_titles},
  {entry_count}× log_entry ({handoff_count} handoff, {dead_end_count} dead_end).
  Open tasks: {open_count}. Last activity: {last_seen_at}.
```

If the prior session has zero activity (e.g. just one `get_context`), the string degrades to a single line: `Last session: 1× get_context, 12s. No tasks touched.`

### `lib/services/sessions.ts:openOrReuse` semantics

- Lookup most-recent session where `token_hash = $1 AND closed_at IS NULL`. If found, update `last_seen_at`, return.
- Else INSERT a new row with `started_at = last_seen_at = now()`, return.

`closed_at` is set by the background job when `last_seen_at < now() - 30min`. We do **not** close sessions eagerly on every call.

### Auto-mint backward compat

If a client omits `session_id`:
- `openOrReuse(token_hash, client_name, client_version)` produces one. It is keyed on `(token_hash, client_name)`, so two different clients using the same token get distinct sessions.
- A misbehaving client that calls once per day will mint a new session each day, leaving gaps. Acceptable.

If a client passes `session_id = 0` or out-of-range:
- Server ignores it and runs `openOrReuse`. Returned `session_id` in response is the minted one.

## API contract changes

### `get_context` request

```diff
 {
   cwd?: string,
   project?: string,
   repo_root?: string,
+  session_id?: number,
   model?: string,
 }
```

### `get_context` response

```diff
 {
   project: { ... },
   project_context: [...],
   open_tasks: [...],
   recent_entries: [...],
   stale_refs: [...],
+  session_id: number,
+  last_session_summary: string | null,
 }
```

### Every other method

```diff
 {
+  session_id?: number,
 }
```

Response gains an `session_id` field that echoes the server's resolved session (minted or reused). Additive; ignored by old clients.

## Pruning

A new `scripts/prune-sessions.ts`:

```ts
import "./env";
import { prune } from "../lib/repositories/sessions";
const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
prune(cutoff).then(() => process.exit(0));
```

Add to `package.json` scripts:

```json
"prune:sessions": "tsx scripts/prune-sessions.ts"
```

Vercel cron job (or manual `pnpm prune:sessions` weekly) keeps the table bounded. Document in README — no automatic scheduling on first deploy.

## Skill framework hook (Layer 3)

`docs/mcp.md` gains a section:

> ### Skill framework integration
>
> If you orchestrate an agent across multiple tasks (e.g. `subagent-driven-development`, custom pipelines), the agent's first call inside each task should be `get_context`. Capture the returned `session_id` and pass it to every subsequent RPC call. Before the task ends, call `log_entry(kind:'handoff', session_id: <id>)`.
>
> todox records every RPC call regardless, so this is belt-and-braces — your explicit entries are how the next session knows *why* a decision was made, not just *that* it was made.

Reference impl: PR to `superpowers/skills/subagent-driven-development` adding `mcp__todox__log_entry` at task completion. Out of scope for this spec.

## MCP standard proposal (separate track)

`docs/superpowers/specs/mcp-session-memory.md` will propose to the MCP working group:

1. **Optional `session_id` integer parameter** on every JSON-RPC method.
2. **Standard `Mcp-Session-Id` header** for HTTP transports.
3. **Server-side mirror log** as a recommended pattern for any stateful MCP server.
4. **Auto-briefing on `initialize` response** (or first tool call) for context-carrying tools.

Submitted as a PR to `modelcontextprotocol/modelcontextprotocol` after todox ships the reference implementation. Out of scope for this spec.

## Testing strategy

### Unit

- `lib/services/params-summary.test.ts` — each method has a deterministic summary; secrets never appear.
- `lib/repositories/sessions.test.ts` — `openOrReuse` creates/mints correctly; `recordCall` is fire-and-forget; `lastSessionSummary` formats correctly.
- `lib/services/rpc.test.ts` — `invoke` records the call even when handler throws.

### Integration

- `pnpm smoke:mcp` — already covers `initialize` + `tools/list` + `tools/call(get_context)`. Add an assertion that the second call returns `session_id > 0` and that `last_session_summary` is non-null after a brief session.

### Backward compat

- Old client (no `session_id` param) → request succeeds, response includes `session_id`, mirror log records it under that ID.
- Client passing `session_id = 0` → server mints a new one.

## Risk analysis

| Risk | Mitigation |
|---|---|
| Mirror log write fails on every call | Fire-and-forget with try/catch; never breaks the response |
| Session ID explodes storage | 30-day TTL; per-token summary, not full params |
| Privacy leak via summary | Per-method allow-list; never include body, path, or secret fields |
| `api_tokens.last_client_*` overlap with `rpc_sessions.client_*` | Two sources of truth. Acceptable; old readers keep working |
| Auto-mint fragmentation | Documented; client upgrade recommended; old clients still get audit |
| Background prune job never runs | Manual `pnpm prune:sessions` works; Vercel cron documented |

## Migration

Three atomic commits, all additive:

1. `feat(sessions): rpc_sessions + rpc_calls tables` — schema + repository.
2. `feat(sessions): mirror log interceptor` — `rpc.ts:invoke()` change + `params-summary.ts`.
3. `feat(sessions): get_context briefing + session_id param` — API change + briefing transform.

Each commit runs `pnpm lint && pnpm test && pnpm exec tsc --noEmit`. DB migration applied via `pnpm db:migrate`.

## Acceptance criteria

- [x] Spec reviewed by user (this document)
- [ ] Plan written via writing-plans skill (next step)
- [ ] Plan reviewed and approved
- [ ] 3 atomic commits land on `feat/session-aware-memory`
- [ ] `pnpm smoke:mcp` shows session_id in response, last_session_summary on second call
- [ ] Old client (no `session_id` param) still works
- [ ] Pruning script tested against a 30-day-old synthetic dataset
- [ ] `docs/mcp.md` updated with skill framework integration section
- [ ] MCP standard proposal drafted at `docs/superpowers/specs/mcp-session-memory.md`

## Out of scope (explicit)

- Vercel cron for automatic pruning (manual `pnpm prune:sessions` for now).
- Multi-MCP session sharing (single MCP = single session model).
- Full params mirroring (privacy + storage cost).
- Removing existing `api_tokens.last_client_*` columns (backward compat).
- Submitting the MCP standard PR (separate, after this ships).

## Open questions for spec review

- Briefing placement: top-level `last_session_summary` string vs. nested under a `last_session` object. Spec chooses top-level string for simplicity; user can flag this.
- Auto-close threshold: 30 minutes feels right but should be tunable per session in the future. Spec leaves a `closed_at IS NULL` index for the query.
- Skill-side hook depth: spec is doc + reference impl only. Vendor-wide rollout is the next spec.