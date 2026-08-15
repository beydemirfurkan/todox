# Contributing

> **Two-source rule.** The "rules the codebase actually follows" section
> below is mirrored verbatim in `AGENTS.md` under "Domain rules". A change
> to one is a change to the other; the duplication is intentional because
> Codex/Cursor will not follow a cross-file reference. The PR template has a
> checkbox to keep them in sync.

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
pnpm build                     # before tsc: PageProps and LayoutProps are
pnpm exec tsc --noEmit         # globals Next generates into .next/types
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
- **A project is a repository, not a path.** `root_path` is where a repo sits
  on one machine and is a different string on the next, so identity is
  `repo_url` first — `repoKey` in `lib/util/paths.ts` folds the clone forms and
  case to one key — then the paths in `project_paths`, one per machine. Never
  the name alone: `~/work/api` and `~/personal/api` are two repositories, and
  fusing their logs is worse than a duplicate, because a duplicate is visible
  and a bad merge is not. The one heuristic that reaches past the remote needs
  the name *and* every known path of the candidate to come from the other OS
  family; anything less registers a second project and says so in a `warning`.
  Not theoretical: identifying a project by one absolute path split `todox` and
  `serled-next` in half the first time each was opened on a second machine, and
  `merge_projects` exists only because `slug` is not updatable and the rows had
  to move.
- **Load in batches.** The database is over the network. A per-row query in a
  list is a per-row round trip; use the `listByTasks`-style helpers.
- **Both dictionaries stay in sync.** `lib/i18n/tr.ts` is typed against the
  keys of `en.ts`, so a missing translation fails the build. Turkish is the
  default language; write it properly rather than machine-translating.
- **No `?` inside SQL string literals.** `lib/db/client.ts` rewrites `?` to
  `$n` positionally and does not parse strings.
- **Writes that must agree run in one transaction.** `tx()` in
  `lib/db/client.ts` takes a list of prepared statements, so a repository
  exposes a `…Stmt` builder beside any write a service may need to pair with
  another table's — the SQL stays with the table that owns it and only the
  sequencing moves. There is no JavaScript between the statements, so a write
  that needs the id of the row just inserted cannot use it; `tasks.create` is
  a CTE for exactly that reason, and is the one place a repository writes
  another table. This is not theoretical tidiness: a dropped second write once
  left a task marked `done` whose last event was `doing`, and every daily
  report after it gained a permanent 24 hours.
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
  path into a real `readFileSync` (`lib/repositories/refs.ts` still carries the
  note). `app/api/mcp/route.ts` is where that temptation comes back, because it
  is an agent surface running in the server process: it answers the filesystem
  questions with `null`, and the tools degrade to "not checked" rather than
  guessing.
- **The agent surface is defined once.** Tools, descriptions and session
  instructions live in `mcp/tools.ts` and are registered by both the hosted
  endpoint and the stdio process. What differs between them is a `Workspace`,
  not a copy of the tool list. `pnpm smoke:mcp` runs the same suite through
  both, which is what keeps that true.
- **Mail bodies are the one place strings are not in both dictionaries.** They
  are inline `lang === "tr" ? … : …` in `lib/services/account-recovery.ts`, so
  the compile-time guarantee below does not cover them. Known, not an
  invitation.
- **Colour never carries meaning alone.** Every status, kind and badge has a
  text equivalent, and controls have real labels.

## The one thing worth arguing about

The product's claim is that the log is worth trusting. Anything that lets a
note quietly go stale, or that makes the agent's write path more expensive than
the human's, is working against that. If a change makes capture harder, say so
in the PR — it is the trade-off that matters most here.
