# todox

Working memory for developers and their agents. Multi-user, web only, no GitHub
integration.

The thesis: **the unit is not a todo, it is a work log.** An issue tracker is
written human-to-human. todox is written agent-to-agent, with a human reading
over its shoulder — so a fresh session can resume work without asking anything.

Four things follow from that, and they are the whole product:

1. **Dead ends are first-class.** The most expensive thing an agent does is walk
   into the same wall a previous session already hit. `dead_end` entries exist
   to stop that.
2. **MCP is the write path.** Every dead todo app died of dual entry. The agent
   authors most of the log during normal work; the web UI is for reading and
   curating. If the human has to type it twice, it is already dead.
3. **Stale context is flagged.** Linked files are hashed when they are linked.
   When a note describes code that has since changed, `get_context` says so.
   Context that lies is worse than no context.
4. **Reports come from the log, not from commits.** Every status change is an
   event, so "what did I finish today, how long did it take, which model did
   it" is a query rather than an archaeology exercise.

## Quick start

```bash
pnpm install
cp .env.example .env.local        # put a Postgres URL in DATABASE_URL
pnpm db:migrate                   # idempotent
pnpm seed                         # optional demo account: demo / todox-demo
pnpm dev                          # http://localhost:3000
```

Any Postgres works. [Neon](https://neon.tech) is what this was built against —
its serverless HTTP driver is what the app uses, which is also why there is no
connection pool to size.

## Connect an agent

The MCP server does not touch the database. An agent runs on a laptop while the
data lives on a server, so it authenticates with a per-user token and calls the
HTTP API. One code path, no local/remote drift — the trade-off being that the
web server has to be running for the agent to work.

Create a token on the Account page; it hands you the exact command:

```bash
claude mcp add todox --env TODOX_TOKEN=todox_… --env TODOX_URL=https://your-todox.example -- pnpm -C /path/to/todox exec tsx mcp/server.ts
```

## Deploying

Vercel plus a hosted Postgres is the intended shape. Set these:

| variable | why |
| --- | --- |
| `DATABASE_URL` | Postgres. Use the pooled connection string. |
| `TODOX_PUBLIC_URL` | Verification and reset links are built from it. Get it wrong and people land on the wrong host. |
| `RESEND_API_KEY`, `MAIL_FROM` | Optional. Without them, mail is printed to the server log instead of sent. |

Run `pnpm db:migrate` once per deploy that changes the schema. It is not run on
cold start on purpose: DDL racing across serverless instances is a bad way to
discover lock contention.

**Coming from the old SQLite version?** `pnpm db:import-sqlite [path]` copies a
`~/.todox/todox.db` into Postgres. Sessions and API tokens are not copied —
sign in and re-issue them.

## Accounts and account safety

Anyone can register: username, email, name, password. No OAuth, no billing.
Sessions are opaque server-side rows behind an httpOnly cookie; passwords are
scrypt (from `node:crypto`, no native dependency). Only hashes are stored — for
passwords, sessions, API tokens and email links alike.

Every project, task, log entry and context note belongs to exactly one account.
Ownership is enforced in `lib/services/ownership.ts` — one place to audit — and
a row belonging to someone else answers 404, never 403, so ids cannot be
probed. `proxy.ts` only redirects on a missing cookie; it cannot reach the
database, so it is UX and never the gate.

**Rate limiting** is a fixed-window counter in Postgres, so the limits hold
across every instance rather than per process. Login counts only *failures*, so
signing in on ten devices never locks you out, and a success clears the
counter. The numbers live in `POLICIES` in `lib/services/rate-limit.ts`.

**Password reset** answers identically whether or not the address is
registered. Links are hashed, single-use, expire in an hour, and issuing a new
one retires the previous one. Completing a reset destroys every session and
signs you in on the device you used.

**Email verification** is tracked and surfaced but does not block ordinary use.
The one thing it gates is creating a public share link, because that is the
only outward-facing action.

**Email delivery is a driver, not a feature.** The default transport prints the
message to the server log — honest in development, and nothing disappears
silently in production. Delivery failures are logged and never change what the
caller is told, because that promise is what keeps reset from leaking whether
an account exists.

The one deliberately public surface is a share link (`/s/<token>`).

## Checks

```bash
pnpm smoke:auth      # rate limits, reset, verification, session invalidation
pnpm smoke:report    # durations, models, importance
TODOX_URL=http://localhost:3000 pnpm smoke:mcp   # needs the server running
```

## Tool surface

| tool | purpose |
| --- | --- |
| `get_context` | **The session-start call.** Global rules, project decisions/conventions/gotchas, every open task with its decisions, dead ends, questions, files and last handoff, plus stale-file warnings. Resolves a project by slug, name, or any absolute path inside it. |
| `create_task` | Capture work. Pass `cwd` and it finds the project — **registering one for that repo if todox has never seen it**, so the agent never has to stop and ask. |
| `activity_report` | What got done today / this week / any window: durations, models, importance, decisions, dead ends, open questions. `format:'markdown'` produces something you can paste into a status update. |
| `update_task` | Status, title, body, priority. Moving to `doing`/`done` is what the duration numbers are built from. |
| `log_entry` | Append `decision` / `dead_end` / `question` / `note` / `handoff` |
| `link_files` | Attach paths and hash them for staleness |
| `add_context` | Durable knowledge; omit the project to make it account-wide |
| `search` | Across all your projects — "have I solved this before?" |
| `list_projects` / `create_project` / `update_project` / `list_tasks` / `get_task` | the rest |

Every write tool takes an optional `model`, and the server instructions tell the
agent to always pass it. That is what makes the per-model breakdown in reports
real rather than guessed.

## The five entry kinds

`decision` what you chose and why the alternatives lost · `dead_end` an approach
that did **not** work · `question` something only a human can answer ·
`handoff` end-of-session state, written for a stranger · `note` everything else.

These are explained inside the app too — the home page carries the loop and the
legend, and the entry composer rewrites its own placeholder for the kind you
pick, so nobody has to come back here to learn the vocabulary.

## Interface

Dark only, Turkish by default (`TR`/`EN` switch in the header, stored in a
cookie). The look is deliberate: cut-paper stickers on dark stock — soft
hairline outlines, flat marker colours, a hand-drawn display face, and a mascot
who shows up in empty states. Colour never carries meaning on its own, every
control has a real label, row actions appear on focus as well as hover, and the
text palette is measured against WCAG AA rather than eyeballed.

## Layout

```
lib/
  constants.ts            shared vocabulary (safe for client components)
  types.ts                row shapes
  cookies.ts              cookie names only — importable from the edge proxy
  util/{paths,time}       hashing, project-root discovery, period maths
  util/{password,tokens}  scrypt hashing, opaque secrets
  db/client.ts            Postgres over HTTP, `?` → `$n`, batch helpers
  db/schema.ts            one idempotent schema
  repositories/           one module per table, no cross-table logic
  services/auth           register, login, sessions, agent tokens
  services/account-recovery  reset + verification tokens
  services/ownership      the single "is this row yours?" authority
  services/rate-limit     the policy table
  services/mailer         pluggable delivery, console by default
  services/rpc            the agent-facing method registry
  services/…              briefing, search, sharing, reports, task writes
  i18n/{index,en,tr}      hand-rolled dictionary, TS-enforced parity
  session.ts              currentUser / requireUser
app/
  components/             presentational primitives
  features/               composed pieces (composer, share panel, auth form…)
  api/rpc/route.ts        bearer-token endpoint the MCP server calls
  <route>/page.tsx        server components that read repositories directly
proxy.ts                  cookie-presence redirect (UX only, never the gate)
mcp/                      stdio MCP server + its HTTP client
scripts/                  migrate, seed, import, three end-to-end smoke checks
```

Repositories never call each other; anything that must stay consistent across
tables (a status change writing a `task_events` row, for example) lives in
`services/task-service.ts`. Anything rendering a list loads in batches —
against a network database, an N+1 that was free on SQLite is not.

## Known gaps

- Search is `ILIKE`, not full-text search.
- Staleness is per-file hash. The honest version is per-symbol or per-commit-range.
- Durations for tasks imported without transition history are a lower bound,
  and the UI marks them with `~`.
- No 2FA, no per-session revocation list, no audit log.
- No keyboard navigation beyond `/` for search.
- Sharing produces an unlisted link, which is only as private as the URL.

## Licence

MIT. See [LICENSE](LICENSE).
