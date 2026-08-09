# Contributing

## Getting it running

```bash
pnpm install
cp .env.example .env.local     # any Postgres; a free Neon branch is fine
pnpm db:migrate
pnpm seed                      # demo / todox-demo
pnpm dev
```

## Before opening a PR

```bash
pnpm lint
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm smoke:auth                # if you touched anything under auth
```

CI runs the first four. `pnpm test` needs no database — it covers the logic
that has none: column allow-lists, RPC parameter validation, report windows,
duration replay. The smoke suites do need one, so they only run where it is
configured.

## The rules the codebase actually follows

These are not style preferences; breaking them causes bugs that are hard to
see in review.

- **Repositories never call each other.** One module per table, no cross-table
  logic. Anything that must stay consistent across tables — a status change
  writing a `task_events` row, say — belongs in `lib/services/`.
- **Ownership is checked in exactly one place.** Add a check to
  `lib/services/ownership.ts`; do not inline a `WHERE user_id = ?` at a call
  site and consider it handled.
- **Foreign rows answer 404.** Never 403, never "not found for you" — the
  message must not tell a caller that an id exists.
- **Load in batches.** The database is over the network. A per-row query in a
  list is a per-row round trip; use the `listByTasks`-style helpers.
- **Both dictionaries stay in sync.** `lib/i18n/tr.ts` is typed against the
  keys of `en.ts`, so a missing translation fails the build. Turkish is the
  default language; write it properly rather than machine-translating.
- **No `?` inside SQL string literals.** `lib/db/client.ts` rewrites `?` to
  `$n` positionally and does not parse strings.
- **Never build a `SET` clause by hand.** Use `setClause(patch, COLUMNS)` from
  `lib/db/client.ts`. Column names cannot be bound as parameters, so they get
  interpolated; patches arrive from `const { id, ...patch } = params` at the
  RPC boundary, and iterating the patch's own keys put caller-chosen text into
  the statement. This was a live SQL injection, not a hypothetical one.
- **Every RPC method has a schema.** `lib/services/rpc-schemas.ts` is the
  runtime contract and the MCP tool surface at once; the handler signatures in
  `rpc.ts` are erased at build time and guard nothing. `methods` is keyed by
  `MethodName`, so a handler without a schema will not compile.
- **The server never touches the filesystem.** It has no checkout, so anything
  that reads a path belongs in `mcp/workspace.ts`, on the machine that holds
  the code. Hashing files and finding a repository root used to happen in
  request handlers, where they returned nonsense and turned a caller-supplied
  path into a real `readFileSync`.
- **Colour never carries meaning alone.** Every status, kind and badge has a
  text equivalent, and controls have real labels.

## The one thing worth arguing about

The product's claim is that the log is worth trusting. Anything that lets a
note quietly go stale, or that makes the agent's write path more expensive than
the human's, is working against that. If a change makes capture harder, say so
in the PR — it is the trade-off that matters most here.
