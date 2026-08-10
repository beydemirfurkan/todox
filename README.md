<img src="docs/logo.svg" width="60" alt="">

# todox

**Working memory for developers and their agents.**
Not a checklist — a log your next session can actually resume from.

[![ci](https://github.com/beydemirfurkan/todox/actions/workflows/ci.yml/badge.svg)](https://github.com/beydemirfurkan/todox/actions/workflows/ci.yml)
[![licence: MIT](https://img.shields.io/badge/licence-MIT-ffd84d)](LICENSE)
[![live](https://img.shields.io/badge/live-todox.dev-6cb7f5)](https://www.todox.dev)

An issue tracker is written human-to-human. todox is written agent-to-agent,
with a human reading over its shoulder. Every task carries the decisions behind
it, the approaches that failed, the questions still open, and the note the last
session left behind.

A fresh agent calls `get_context`, reads all of that, and starts where the last
one stopped — without walking into a wall somebody already hit.

## What goes in a log

| kind | what it means |
| --- | --- |
| `decision` | what you chose, and why the alternatives lost |
| `dead_end` | an approach that did **not** work — the highest-value entry, because it stops the repeat |
| `question` | something only a human can answer |
| `handoff` | end-of-session state, written for a stranger |
| `note` | everything else |

Two things fall out of treating the log as the product:

- **Stale context is flagged, and never faked.** Linked files are hashed by the
  side that can see them — the agent — and the server stores the hashes and
  compares. If the code moves on, `get_context` says the note may be lying.
  Until an agent has actually looked, the note is marked as never checked
  rather than claimed to be fresh: context that lies is worse than none, and
  that includes lying about how sure we are.
- **Reports come from the log, not from commits.** Every status change is an
  event, so *what did I finish today, how long did it take, which model did it*
  is a query rather than archaeology.

## Try it

**[todox.dev](https://www.todox.dev)** — anyone can register. Small personal
deployment, no uptime promise. Self-host if the log matters to you.

## Run your own

```bash
pnpm install
cp .env.example .env.local     # any Postgres; a free Neon branch works
pnpm db:migrate                # idempotent
pnpm seed                      # optional demo account: demo / todox-demo
pnpm dev
```

## Connect an agent

todox is a remote MCP server. There is nothing to install and no repository to
clone: point any MCP client at the URL with an agent token.

Create a token on the Account page and it hands you text you can paste straight
into whichever agent you use, plus the config snippet for the four common ones.
The shape is always the same — one URL, one header:

```bash
# Claude Code
claude mcp add --transport http todox https://www.todox.dev/api/mcp \
  --header "Authorization: Bearer todox_…"
```

```toml
# Codex — ~/.codex/config.toml
[mcp_servers.todox]
url = "https://www.todox.dev/api/mcp"
http_headers = { Authorization = "Bearer todox_…" }
```

```json
// Cursor — .cursor/mcp.json   (VS Code uses .vscode/mcp.json and "servers")
{
  "mcpServers": {
    "todox": {
      "type": "http",
      "url": "https://www.todox.dev/api/mcp",
      "headers": { "Authorization": "Bearer todox_…" }
    }
  }
}
```

Spell out `"type": "http"`. A client that finds a `url` without one tends to
assume a local command and fails with something unhelpful.

### Optional: local mode

The hosted server has no filesystem — but your agent does, and that is enough:
it sends the hash when it links a file and calls `report_file_hashes` with what
it finds afterwards, so staleness works over HTTP like anywhere else.

The stdio server does that part itself rather than asking. Worth running if you
would rather not spend an agent's attention on it, or want the hashing to
happen even when the agent forgets:

```bash
TODOX_TOKEN=todox_… TODOX_URL=https://www.todox.dev pnpm -C /path/to/todox mcp
```

### Tools

| tool | what it does |
| --- | --- |
| `get_context` | **Call this first.** Standing rules, project decisions and gotchas, every open task with its decisions, dead ends, questions, files and last handoff — plus stale-file warnings. Resolves a project from a slug, a name, or any path inside it. |
| `create_task` | Capture work. Pass `cwd` and it finds the project, **registering one for that repo if it has never seen it** — so the agent never stops to ask. |
| `update_task` | Status, title, body, priority. Moving to `doing`/`done` is where durations come from. |
| `log_entry` | Append one of the five kinds. |
| `activity_report` | Today / this week / any window: durations, models, importance, decisions, dead ends, open questions. `format:"markdown"` is written to be pasted into a status update. |
| `link_files` | Attach paths with their hashes. Safe to call again for the same file. |
| `report_file_hashes` | Hosted only: what the linked files look like on disk now. The local process does this for itself. |
| `add_context` | Knowledge that outlives a task; omit the project to make it account-wide. |
| `search` | Across all your projects — *have I solved this before?* |
| `get_task` | One task with its log and linked files. |
| `list_tasks` · `list_projects` | The plain lists, when `get_context` is more than you need. |
| `create_project` · `update_project` | Rarely needed: `create_task` with a `cwd` registers one. A summary is worth adding. |

Every write tool takes a `model`, and the server instructions tell the agent to
always pass it. That is what makes the per-model breakdown real rather than
guessed.

### Prompts

Three, because there are three moments this is for. They show up in your
client's own menu, so you can see what the server does without reading
anything:

| prompt | when |
| --- | --- |
| `start_session` | before planning — read what earlier sessions established |
| `wrap_up` | before finishing — leave a handoff, and the dead ends especially |
| `standup` | when somebody asks what got done |

## Deploying

Vercel plus a hosted Postgres.

| variable | why |
| --- | --- |
| `DATABASE_URL` | Postgres. Use the pooled connection string. |
| `TODOX_PUBLIC_URL` | Verification links, reset links and the agent setup snippet are built from it — get it wrong and people, and their agents, land on the wrong host. |
| `SMTP_HOST` · `SMTP_USER` · `SMTP_PASS` · `MAIL_FROM` (· `SMTP_PORT`) | Optional, but the first four together. Without them mail is printed to the server log rather than sent. Port defaults to 587 (STARTTLS); the address in `MAIL_FROM` should match `SMTP_USER`, since most providers reject a `From` they did not authenticate. If the provider's sending limit is hit, messages are dropped and the failure shows up only in the log. |

Run `pnpm db:migrate` when the schema changes. It deliberately does not run on
cold start: DDL racing across serverless instances is a bad way to discover lock
contention.

Coming from the old SQLite version? `pnpm db:import-sqlite [path]` copies a
`~/.todox/todox.db` across.

## Security

Passwords are scrypt; sessions, agent tokens and email links are stored as
hashes only. Ownership is enforced in one module, and a row belonging to someone
else answers 404 rather than 403 so ids cannot be probed. Rate limits live in
the database, so they hold across instances.

Details, and an honest list of what is **not** covered, in
[SECURITY.md](SECURITY.md).

## Known gaps

- Search is `ILIKE`, not full-text.
- Staleness is per-file hash; per-symbol would be the honest version. Hosted,
  it depends on the agent actually sending hashes — the instructions ask, and
  nothing can make it.
- The smoke suites need a database. Point `DATABASE_URL` at a throwaway branch
  and CI runs them; without the secret that job skips and says so.
- No 2FA, no per-session revocation, no audit log.
- Share links are unlisted, not access-controlled.
- No keyboard navigation beyond `/` for search.

## Contributing

The rules the codebase actually follows, and how to run the checks:
[CONTRIBUTING.md](CONTRIBUTING.md).

MIT — see [LICENSE](LICENSE).
