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
cp .env.example .env.local     # any Postgres 15+; see below for a container
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
# Claude Code. --scope user, because the default is this directory only.
claude mcp add --scope user --transport http todox https://www.todox.dev/api/mcp \
  --header "Authorization: Bearer todox_…"
```

```json
// OpenCode v1 — ~/.config/opencode/opencode.json.
// MCP key is `mcp` (server name is a direct key under it), NOT `mcpServers`.
// `type` is `"remote"`, NOT `"http"` — the Claude/Cursor/VS Code value is
// silently ignored on OpenCode.
{
  "mcp": {
    "todox": {
      "type": "remote",
      "url": "https://www.todox.dev/api/mcp",
      "headers": { "Authorization": "Bearer todox_…" }
    }
  }
}
```

```jsonc
// OpenCode v2 — same key, server now nested under `mcp.servers`.
{
  "mcp": {
    "servers": {
      "todox": {
        "type": "remote",
        "url": "https://www.todox.dev/api/mcp",
        "headers": { "Authorization": "Bearer todox_…" }
      }
    }
  }
}
```

```toml
# Codex — ~/.codex/config.toml
[mcp_servers.todox]
url = "https://www.todox.dev/api/mcp"
http_headers = { Authorization = "Bearer todox_…" }
```

```json
// Cursor — ~/.cursor/mcp.json, the one in your home directory.
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

```json
// VS Code — the user-level mcp.json ("MCP: Open User Configuration").
// The root key is "servers", NOT "mcpServers". This is the one client
// that differs, and getting it wrong is silent.
{
  "servers": {
    "todox": {
      "type": "http",
      "url": "https://www.todox.dev/api/mcp",
      "headers": { "Authorization": "Bearer todox_…" }
    }
  }
}
```

> **The MCP config key and the `type` value differ per agent, and the
> wrong combination is silently ignored — no error, no warning, the tool
> just does not show up:**
>
> | agent | key | `type` |
> | --- | --- | --- |
> | Claude Code | `mcpServers.NAME` | `"http"` |
> | OpenCode v1 | `mcp.NAME` | `"remote"` |
> | OpenCode v2 | `mcp.servers.NAME` | `"remote"` |
> | Cursor | `mcpServers.NAME` | `"http"` |
> | VS Code (Copilot Chat) | `servers.NAME` | `"http"` |
> | Codex | TOML `[mcp_servers.NAME]` | n/a |

Where those files live differs by platform, and VS Code is the one that is
not where a Linux habit puts it:

| agent | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Claude Code | `~/.claude.json` | same | same |
| Cursor | `~/.cursor/mcp.json` | same | same |
| Codex | `~/.codex/config.toml` | same | same |
| OpenCode | `~/.config/opencode/opencode.json` | same | same |
| VS Code | `~/Library/Application Support/Code/User/mcp.json` | `~/.config/Code/User/mcp.json` | `%APPDATA%\Code\User\mcp.json` |

**Install it globally, not per project.** Every one of these tools defaults to
the directory you are standing in — `claude mcp add` without a scope,
`.cursor/mcp.json`, `.vscode/mcp.json` — and a memory that only exists in one
repository is the opposite of the point. It also fails quietly: the tools
simply are not there in the next project, so the agent never mentions them.

Spell out `"type": "http"`. A client that finds a `url` without one tends to
assume a local command and fails with something unhelpful.

### Then tell your agent to use it

Connecting is not the same as being used, and the gap is bigger than it looks.
An MCP server's `instructions` are background reading; a skill or a CLAUDE.md
rule is an instruction. When they disagree, the server loses — measured, in a
fresh project, with todox connected the whole time and never once called.

So put four lines in the memory file your agent actually obeys:

```markdown
todox MCP is installed here — persistent memory across projects.

- Call `get_context` before starting non-trivial work (cwd = your working
  directory). It registers a new repo by itself.
- `create_task` for anything that will not finish this session.
- Before stopping, `log_entry(kind:'handoff')` on every task you touched,
  and `dead_end` for approaches that failed.
- Always pass your own model id.
```

Or let the installer do it:

```bash
pnpm install:mcp claude-code --write-memory
```

It is off unless asked, because that file is yours rather than ours, and it is
idempotent — the block is fenced with an HTML comment, so a second run replaces
it instead of leaving two sets of instructions where the older one wins. Add
`--dry-run` to see the exact block first.

**The user-level file, not the project one.** This is the same trap as the
config above, one directory over:

| Agent | The file that applies everywhere |
| --- | --- |
| Claude Code | `~/.claude/CLAUDE.md` |
| Codex | `~/.codex/AGENTS.md` |
| Cursor | `~/.cursor/rules/todox.md` |
| VS Code | `~/.copilot/instructions/todox.md` |
| OpenCode | `~/.config/opencode/AGENTS.md` |

A repository's own `AGENTS.md`, and the per-project rules files the editors also
read, apply inside that checkout only. A cross-project memory installed into one
project is the thing this whole section exists to avoid.

The token stays out of that file — it lives in your MCP config. This is the
habit, not the credential.

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
| `delete_entry` | For an entry that was wrong when it was written. One overtaken by later work is history, not an error — append instead. |
| `activity_report` | Today / this week / any window: durations, models, importance, decisions, dead ends, open questions. `format:"markdown"` is written to be pasted into a status update. |
| `link_files` | Attach paths with their hashes. Safe to call again for the same file. |
| `report_file_hashes` | Hosted only: what the linked files look like on disk now. The local process does this for itself. |
| `accept_file_change` · `unlink_file` | Clear a stale warning once you have read the change, or drop a link that has stopped meaning anything. Nothing else can clear it — the server never sees the file. |
| `add_context` | Knowledge that outlives a task; omit the project to make it account-wide. |
| `update_context` · `delete_context` | Correct a note that turned out wrong. A log that can only be added to stops being worth reading. |
| `search` | Across all your projects — *have I solved this before?* |
| `get_task` | One task with its log and linked files. |
| `list_tasks` · `list_projects` | The plain lists, when `get_context` is more than you need. |
| `create_project` · `update_project` | Rarely needed: `create_task` with a `cwd` registers one. A summary is worth adding. |
| `delete_project` | The way back from a mistyped `cwd`. Takes the project and everything under it; `confirm` must be the slug. |
| `merge_projects` | The way back from one repo registered twice. Moves tasks, notes and paths into the surviving project; `confirm` must be the slug of the one being merged away. |

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

A container and a Postgres beside it. The `Dockerfile` at the root builds the
app; todox.dev runs both on one host, on a private Docker network, so the
database publishes no port at all.

| variable | why |
| --- | --- |
| `DATABASE_URL` | Postgres. When the database is a neighbour on the same network this is its service name, and no certificate or public port is involved. |
| `DATABASE_POOL_MAX` | Optional, default 10. Connections this process may hold. Raise it only after checking the server's own `max_connections`, which every replica shares. |
| `TODOX_PUBLIC_URL` | Verification links, reset links and the agent setup snippet are built from it — get it wrong and people, and their agents, land on the wrong host. |
| `SMTP_HOST` · `SMTP_USER` · `SMTP_PASS` · `MAIL_FROM` (· `SMTP_PORT`) | Optional, but the first four together. Without them mail is printed to the server log rather than sent. Port defaults to 587 (STARTTLS). What `MAIL_FROM` may be depends on the provider: a mailbox provider usually wants the address that authenticated, while an API-key provider wants any address on a domain verified with it. If a sending limit is hit, messages are dropped and the failure shows up only in the log. |

Run `pnpm db:migrate` when the schema changes. It deliberately does not run at
startup: DDL racing between instances of a rolling deploy is a bad way to
discover lock contention, and the schema is idempotent precisely so the decision
can be made after a deploy rather than during one. From the host:

```bash
docker exec <container> pnpm db:migrate
```

That is also why the image keeps its dev dependencies instead of using Next's
`standalone` output — pruning them removes `tsx` and everything under
`scripts/`, and a database that is deliberately unreachable from the internet
can only be migrated from something already inside the network.

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
- Coverage sits around 39%, and the shape matters more than the number: the
  agent surface, the auth boundary and the repositories that answer "is this
  yours" are covered, while much of the UI is not.
- No 2FA, no per-session revocation, no audit log.
- Share links are unlisted, not access-controlled.
- No keyboard navigation beyond `/` for search.

## Contributing

The rules the codebase actually follows, and how to run the checks:
[CONTRIBUTING.md](CONTRIBUTING.md).

MIT — see [LICENSE](LICENSE).
