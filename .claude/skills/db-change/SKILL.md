---
name: db-change
description: Use when writing SQL, adding a column or table, or touching anything under lib/db or lib/repositories in todox. Two of these rules exist because of a live SQL injection, not a hypothetical one.
---

# Touching the database

## No `?` inside a SQL string literal

`lib/db/client.ts` rewrites `?` to `$n` positionally. **It does not parse
strings**, so a question mark inside a quoted literal shifts every parameter
after it.

```sql
-- wrong: the literal eats a placeholder slot
WHERE note = 'why?' AND user_id = ?
```

## Never build a `SET` clause by hand

Use `setClause(patch, COLUMNS)` from `lib/db/client.ts`. Column names cannot be
bound as parameters, so they are interpolated — and patches arrive from
`const { id, ...patch } = params` at the RPC boundary. Iterating the patch's own
keys put caller-chosen text into the statement. **That was a live SQL
injection.** The allow-list is the fix; do not route around it.

## One module per table

- `lib/repositories/` — one file per table, no cross-table logic.
- **Repositories never call each other.** Anything that must stay consistent
  across tables — a status change writing a `task_events` row — belongs in
  `lib/services/`.

## Ownership is checked in exactly one place

`lib/services/ownership.ts`. Do not inline `WHERE user_id = ?` at a call site
and consider it handled. **A row belonging to somebody else answers 404**, never
403 and never "not found for you": the message must not tell a caller that an id
exists.

## Load in batches

The database is over the network. A per-row query inside a list is a per-row
round trip — use the `listByTasks`-style helpers.

## Schema and migrations

- The schema lives in `lib/db/schema.ts` and is idempotent.
- `pnpm db:migrate` is a **deploy step**, run deliberately. It does not run on
  cold start: DDL racing across serverless instances is a bad way to discover
  lock contention.
- Nothing queries the database at build time — every page is `force-dynamic`,
  which is what keeps CI free of secrets.

## The server has no filesystem

It has no checkout. Anything that reads a path belongs in `mcp/workspace.ts`, on
the machine that holds the code. Hashing files and finding a repository root
used to happen in request handlers, where they returned nonsense and turned a
caller-supplied path into a real `readFileSync`.

## Verifying

```bash
pnpm test                      # column allow-lists, RPC param validation
pnpm smoke:auth                # needs a DATABASE_URL; run it if you touched auth
```

Full rules: [CONTRIBUTING.md](../../../CONTRIBUTING.md).
