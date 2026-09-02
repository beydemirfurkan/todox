<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# todox — agent rules

This file is read directly by Codex, Cursor, OpenCode and VS Code Copilot as
plain markdown (Codex has no `@import` support — `@AGENTS.md` is a Claude Code
extension). Claude Code reaches it through `CLAUDE.md`, which imports this
file.

> **Two-source rule (also captured in the PR template and `CONTRIBUTING.md`):**
> the "Domain rules" section below is mirrored verbatim in
> `CONTRIBUTING.md` under "The rules the codebase actually follows". A change
> to one is a change to the other; the duplication is intentional because
> Codex/Cursor will not follow a cross-file reference.

## Sprint workflow

Think → Plan → Build → Review → Test → Ship → Reflect. No step is optional.

- **Think.** "Is this the right problem?" What the user said and what they
  meant can differ. Surface assumptions before committing to them.
- **Plan.** 2-3 alternatives. At minimum a minimal viable and an ideal
  architecture. Justify the recommendation; let the user pick.
- **Build.** Small, atomic commits. One commit = one logical change.
- **Review.** Read your own diff: scope creep, missing edge cases, silent
  failures, security. Walk the `gstack-review` checklist.
- **Test.** Run the affected tests. Write a regression test for new code.
- **Ship.** Open a PR; CI must be green. Verify production after merge.
- **Reflect.** What went well, what did not. One or two sentences.

### Confusion protocol

On high-risk uncertainty (two viable architectures, a destructive operation,
missing context) — STOP. Name the uncertainty in one sentence. Offer 2-3
options. Ask the user. Do not guess on architectural or data-model decisions.

### 3-strike rule

If you have tried a task three times and failed — STOP and escalate. A
wrong architecture is a wrong hypothesis; bad work is worse than no work.

### Boil the lake

With AI, completeness is nearly free. Do not leave edge cases, test
coverage or error paths half-done. "Good enough for now" is a pre-AI reflex.

## Coding rules (clean code)

- **Names carry intent.** `data`, `info`, `temp`, `foo`, `x`, `util`, `helper`,
  `manager`, `handler` carry none — banned. Booleans: `is`/`has`/`can`/`should`.
  Functions: verbs or verb phrases. Classes/types: nouns.
- **Functions are small and do one thing.** A function over 20 lines is
  usually a split signal. Mix one level of abstraction per function.
- **Parameters:** 0 ideal, 1-2 good, 3 borderline, 4+ should be an object.
- **Boolean flag parameter is banned.** `render(true)` says nothing. Two
  functions: `renderAsDraft()`, `renderAsFinal()`.
- **Guard clauses, early return.** Less nesting.
- **DRY — but don't overdo.** Extract on the third repetition ("rule of
  three"). Two similar-looking pieces of code can evolve apart; premature
  abstraction is worse than duplication.
- **Comments are the last resort.** Code that needs a comment usually needs
  better names first. Acceptable: `TODO(name, #issue): ...`. Not acceptable:
  restating the diff, or commented-out old code.
- **Errors are explicit.** Empty `catch` is banned — at minimum log it.
  `throw "string"` is banned — always throw `Error` or a subclass. One
  `try/catch`, one responsibility.
- **File names: kebab-case, no exceptions.** React components included.
  Inside the file, the component is `PascalCase`.
- **TypeScript:** `any` is banned — use `unknown` + a type guard. `as`
  assertion is the last resort. Explicit return types on public APIs.
  `interface` for object shapes, `type` for unions/intersections/aliases.
  Prefer `as const` + union over `enum`. Non-null assertion (`!`) only when
  you genuinely know it's not null.

## Domain rules (this repo — mirrored in CONTRIBUTING.md)

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
  keys of `en.ts`, so a missing translation fails the build. English is the
  default only because a client that states no preference is usually not a
  person: Googlebot and every link-preview fetcher send no `Accept-Language`,
  so a Turkish default meant every search result and every pasted link was
  Turkish. A Turkish browser sends `tr` and still gets Turkish. Write the
  Turkish properly rather than machine-translating it — it is a first-class
  language here, not a translation of the English.
- **No `?` inside SQL string literals.** `lib/db/client.ts` rewrites `?` to
  `$n` positionally and does not parse strings.
- **Writes that must agree run in one transaction.** `tx()` in
  `lib/db/client.ts` takes a list of prepared statements, so a repository
  exposes a `…Stmt` builder beside any write a service may need to pair with
  another table's — the SQL stays with the table that owns it and only the
  sequencing moves. There is no JavaScript between the statements, so a write
  that needs the id of the row just inserted cannot use it; `tasks.create` is a
  CTE for exactly that reason, and so is `project-invitations.acceptWithNewUser`,
  which has to create the account before it can grant it anything. Those two are
  the exceptions; a third needs the same justification, not the same shape.
  This is not theoretical tidiness: a dropped second write once
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
  live in `lib/services/mail-templates.ts`, one function per message returning
  `subject`, `text` and `html` for both languages, so the compile-time
  guarantee below does not cover them — nothing fails the build if a
  translation drifts. Two rules hold there instead: every template returns
  `text` as well as `html`, because a message with no plain-text part scores
  worse with spam filters and is what a screen reader reads; and every
  interpolated value goes through `esc`, because names and project names are
  chosen by people and two of these messages are security notices.
- **Colour never carries meaning alone.** Every status, kind and badge has a
  text equivalent, and controls have real labels.
- **Measurement counts, and never carries content.** `tool_usage` records a
  method name, a day and two counts; `pnpm funnel` derives its numbers from
  columns that were already there. Neither stores a parameter, a body, a path
  or an id, and `docs/mcp.md` states that in the promise it makes to somebody
  running their own instance. The pressure to add "just the project id, for
  debugging" is exactly the pressure this rule exists against: a measurement
  table is the one place where a product about trusting the log can start
  keeping a second log nobody agreed to.
- **An observation is not an entry.** Automatic capture writes to
  `observations`, a separate table the briefing returns in its own labelled
  section. Material nobody has vouched for must not be able to reach `entries`:
  the log is worth reading because somebody decided each line belonged there,
  and folding activity into it buys recall by spending exactly that. The one
  way across is an agent passing `from_observation_id` to `log_entry` or
  `add_context`, which writes the agent's own words and marks the observation
  handled in the same transaction. Unpromoted observations expire on their own.

## Cross-file workflows (skills)

For work that spans several files and goes wrong quietly, Claude Code and
OpenCode auto-load `.claude/skills/<name>/SKILL.md`. Codex and Cursor do
not auto-load skills; the summary below is enough to recognise *when* to
open a skill, but **for the actual change, open the relevant `SKILL.md`** —
the detail beats the summary on 6+ step tasks.

- **`add-rpc-method`** — adding, renaming or removing a todox RPC method
  or MCP tool. The order is six steps + a verification:
  1. `lib/services/rpc-schemas.ts` — add the parameter shape to `SHAPES`
     (`.strict()` in `OBJECTS`, `.refine()` on patches to require at least
     one field; `.describe()` text is read by a model deciding whether to
     call the tool).
  2. `lib/services/rpc.ts` — add it to `methods` (`satisfies
     Record<MethodName, …>`; a handler without a schema is a compile
     error — keep that guardrail).
  3. **Work location.** One table → a repository in `lib/repositories/`.
     More than one table, or anything that must stay consistent across
     tables → `lib/services/`. Repositories never call each other.
  4. `mcp/tools.ts` — register with the `tool()` helper for both
     transports. Use `overrides`/`prepare`/`after`/`transform` so the
     model is not asked for things only this side knows. Update `BASE` in
     the same file if the new tool changes session-start or wrap-up
     behaviour, and `LOCAL_NOTE`/`REMOTE_NOTE` if the advice differs by
     mode.
  5. `README.md` — add to the Tools table. A tool that is not in the
     table does not exist as far as a reader is concerned.
  6. `lib/services/rpc-schemas.test.ts` — assert the params that must be
     rejected. Runs in CI without a database.
  + verification: `pnpm smoke:mcp` runs the whole agent surface through
  both transports against a live server. A tool that only works one way
  in is where that shows.
  + before done: `pnpm lint && pnpm test && pnpm build &&
  pnpm exec tsc --noEmit` (the last one covers `mcp/` and `scripts/`; the
  build does not).

- **`db-change`** — SQL rules. Two of them exist because of a real
  injection; `setClause` and the `?`-inside-literals rules are not
  restated elsewhere, so do not surprise them.
- **`i18n-strings`** — both dictionaries stay in sync; `t` cannot cross
  into a client component without a small ceremony.
- **`ui-conventions`** — CSS helpers and the mobile layout rules each bug
  taught us.

## Git flow

- **Branches:** `<type>/<short-description>`, kebab-case, English,
  imperative. Examples: `feat/user-profile-page`, `fix/login-redirect-loop`,
  `chore/upgrade-node-22`. Under 50 characters. Ticket prefix when present:
  `feat/PROJ-123-user-profile`.
- **Commit messages:** Conventional Commits.
  `<type>(<scope>): <summary>` — summary ≤ 72 chars, imperative, no
  trailing period. Body answers "why", not "what" (the diff already shows
  what). One commit = one logical change.
- **Do not auto-commit.** The user must explicitly ask for `git commit`,
  `git push`, `git merge`, `git rebase`. Summarise in Jira format and wait
  for approval. Jira format:

  ```
  ## Summary
  One or two sentences: what was done.
  ## Type
  Feature | Bug | Refactor | Chore | Docs | Test
  ## Changes
  - <file> — what changed, why
  - <file> — what changed, why
  ## Acceptance Criteria
  - [x] criterion 1 (met)
  - [ ] criterion 2 (not met — reason)
  ## Testing
  Which commands, what was the result.
  ## Notes
  Trade-offs, technical debt to revisit, known limits. "None" if empty.
  ```

- **No direct commits to `main`/`master`/`develop`.** Always a feature
  branch.
- **Never force push.** `git rebase` on a shared branch is a question, not
  a default.
- **`.gitignore` hygiene:** `node_modules/`, `.next/`, `dist/`, `build/`,
  `coverage/`, `.env*`, IDE files. If a secret slips into a commit, tell
  the user immediately; do not rewrite history without explicit consent.

## MCP usage (only when the todox MCP server is connected)

The four lines below are also in `CLAUDE.md` and in the server's
`instructions` — the repetition is intentional, so whichever file the
agent reads first carries them. Skip this section if the MCP server is
not connected.

- Call `get_context` with `cwd` set to your absolute working directory
  before any non-trivial work. It registers a new repo for that path on
  its own.
- `create_task` for anything that will not finish this session. Pass
  `cwd`.
- Before stopping, `log_entry(kind: "handoff")` on every task you
  touched, and `dead_end` for approaches that failed.
- Always pass your own model id on write tools.
