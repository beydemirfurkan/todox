# todox MCP — client-side rules

These four lines are the user-scope contract. Paste them into whatever file
your client reads as global instructions.

1. Before planning any non-trivial work, call `get_context` with `cwd` set to
   the absolute path of the directory you are working in. It registers the
   project on first call and returns the briefing for that session.

2. On the methods that write -- `create_task`, `update_task`, `log_entry` --
   pass `model` with your own model id. It is stored on the row, so reports
   can say which model did what. Nothing else reads it.

3. When work that will not finish this session comes up, call `create_task`
   with `cwd` (or an explicit `project`) and the goal in `body`. Its compact
   receipt confirms the task path and saved body length without echoing the
   body. Status moves with `update_task`.

4. Before stopping, call `session_status` with `cwd`: it lists the tasks you
   touched this session and whether each has a handoff since, plus any left
   `doing` for a week. Then `log_entry(kind:'handoff')` on every task it
   names, and `log_entry(kind:'dead_end')` for every approach that did not
   work. The next session is the consumer; write for them, not for yourself.

## Install

Run `pnpm install:mcp <client>` once and the CLI writes the right config file
and verifies the connection. `<client>` is one of:
`claude-code`, `codex`, `cursor`, `vscode`, `opencode`.

```bash
pnpm install:mcp claude-code --token todox_…
```

The token comes from `--token`, or `$TODOX_TOKEN`, or a muted prompt when the
terminal is interactive. `--dry-run` prints the plan — including any stale
entry it finds — and writes nothing.

| flag | default | what it is for |
| --- | --- | --- |
| `--url` | `https://www.todox.dev/api/mcp` | point at a dev server |
| `--token` | `$TODOX_TOKEN`, else a prompt | the agent token |
| `--transport` | `http` | `stdio` is OpenCode only |
| `--opencode-layout` | detected | force `v1` or `v2`; see below |
| `--write-memory` / `--no-write-memory` | asked in a terminal (yes by default), off otherwise | the four-line habit, in the client's user-level memory file |
| `--write-skill` | off | the whole session protocol, as a `SKILL.md` the client loads by description |
| `--dry-run` | off | plan only, nothing written |
| `--verbose` | off | platform, node version and resolved home |

Neither is written without consent, because the file, or the directory, is the
user's: the memory habit is asked for in a terminal and defaults to yes there,
since a connection with no habit is the usual way todox goes unused; the skill
is off unless passed. The memory file is edited as a guest — todox's lines in a
fenced block, everything else untouched. The skill file is wholly todox's
(`<skills dir>/todox/SKILL.md`), generated from the same text the server sends
at `initialize`, and replaced whole on a later run so an upgrade carries into
it. The doctor below reports both.

A failing doctor always prints why, with or without `--verbose`, and says that
the config was written — a bare `FAIL` over a config that exists is the worst
of both.

Where each client reads its config is in
`scripts/install-mcp/clients/contract.ts` — one table, used by the installer,
by `verify`, and by the platform matrix in `contract.test.ts`. Nothing else
names a path or a root key. It is written down once because the alternative
shipped: the VS Code installer used the Linux path on macOS, and `verify` read
the file back from the same wrong place and reported success.

### Two things the CLI will tell you about

**A stale entry.** If a todox entry is sitting somewhere this client does not
read — a config from a version that wrote the wrong path, or the other
OpenCode layout — the CLI lists it and leaves it alone. Removing it is a
one-line edit and it is your file; the point is that you know it is there.

**An assumed OpenCode layout.** OpenCode v1 keys servers directly under `mcp`,
v2 nests them under `mcp.servers`, and writing the wrong one is silent. An
existing config settles it. A fresh one cannot, so the CLI writes v2, says it
assumed, and tells you the flag to overrule it:

```bash
pnpm install:mcp opencode --opencode-layout v1
```

## Check an install

Two questions, two commands. "Does this server answer this token from here?":

```bash
pnpm mcp:doctor https://www.todox.dev/api/mcp todox_…
```

`initialize`, then `tools/list`, then a real `get_context` call — so auth,
schema and project resolution are all exercised rather than assumed. The
install CLI runs the same pass at the end of an `http` install.

And the question that arrives weeks later, "I set it up and the tools do not
show" — which needs no clone and no token in the environment:

```bash
npx https://github.com/beydemirfurkan/todox/releases/latest/download/todox-mcp.tgz doctor
```

It reads the config file each of the five clients actually reads, on this
platform, and says per client what it found: an entry that is fine (token
masked), an entry with a `type` the client ignores, one under a root key the
client does not look at, one in a file an older todox wrote to the wrong place,
or none. Beside a working entry it says whether the client's memory file
carries the habit, because a connected server nobody reaches for is the failure
this whole page is about. It also looks in the directory it was run from for
the per-checkout files (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`,
`opencode.json`) and names a todox entry there for what it is: a memory that
exists in one repository. Run inside a repository, it also says whether the
git hook is installed there, and warns about one that would fail silently on
every commit — a missing script or token. Then it reaches the server with
every token it saw.
Exit code 0 when at least one entry is usable, nothing is broken and every
server answered; 1 otherwise. It changes nothing.

`pnpm mcp:doctor` with no arguments does the same from a clone.

If you install by hand, the JSON / TOML shape per client is documented in
`scripts/install-mcp/clients/`, and the per-platform paths are in the README's
"Connect an agent" section.

## What every agent sends about where the code is

Identity is a repository, not a folder, so todox stores both halves of it:
the absolute path of each checkout, one per machine (`root_path`, and the
paths in `project_paths`), and the repository's remote (`repo_url`), with any
username or password in the URL stripped before it is saved. Files you link
are stored as their path and a sha256 of their contents, so a note can be
flagged when the code under it changes. The contents themselves are never
sent. A path is a fact about your disk -- `/Users/<you>/...` names you -- and
it is shown back to you on the project page as where each machine keeps the
checkout.

## What the local process records on its own

The stdio transport does one thing nobody asks it to. While a session runs it
watches the checkout it was started in and keeps a single row describing what
that session did to the tree: the branch, where `HEAD` was when it opened and
where it is now, how many commits landed, the first few subject lines, and how
many files carry uncommitted changes — and, because it rides on every tool
call, the ids of the tasks that session set to `doing`. `get_context` hands
those back to the next session in an `observations` section, and beside each
row names the tasks it took on that are still open with no handoff written
since (`handoff_missing`): the branch, the commits and the task a session left
without a word, finally on one line.

The reason is the session that ends without a handoff — the agent stops, or
the process is killed, and everything about what was in flight is gone. This
is the part that survives that, because it is written as the work happens
rather than summarised at the end.

Three properties are worth knowing, because they are what keep it from being
noise:

- **It is not the log.** Observations live in their own table and their own
  section of the briefing, labelled unverified. Nothing an agent reads there
  becomes a decision or a dead end unless an agent decides it should and
  writes one, in its own words.
- **A quiet session writes nothing.** No commits, no uncommitted changes and
  no task set to `doing` means no row at all, and repeated writes during one
  session replace that row rather than adding to it.
- **It expires.** Two weeks, unless something promotes it first. The git
  history it describes is still in git, which is the better copy.

What leaves your machine is a branch name, commit hashes, commit subject lines,
a count of changed files and the ids of tasks set to `doing` — ids todox
issued, naming rows it already holds. No file contents, no diffs, and nothing
from the conversation. Turn it off with an environment variable on the MCP
server entry:

```json
"env": { "TODOX_TOKEN": "todox_…", "TODOX_OBSERVE": "off" }
```

Only `off` disables it — an unset variable means on, because a switch that
needs setting to work is one nobody remembers. The hosted transport never does
any of this: it has no filesystem, so it has nothing to look at.

**A second carrier, for the hosted endpoint.** Connected to `/api/mcp`, there is
no local todox process to do the watching — which is most people. The
plugin's hooks (Claude Code from plugin 0.1.5; Codex from the release after
0.1.6) run on your machine at a session's
edges — the Stop hook after every turn, if git changed since the last one it
sent, and SessionEnd — and send the same row with `source: "plugin-hook"`
(`"claude-code-hook"` up to 0.1.6) and `client` naming the agent
(`claude-code-plugin` or `codex-plugin`): the same fields, built by the same function as the stdio
observer's, the same table, the same two weeks, keyed by Claude Code's own
session id (`cc:<id>`). `TODOX_OBSERVE=off` turns this carrier off too. Each row in the briefing
says which carrier saw it. Where the stdio process is already watching the same
project for your account, a hook's row is skipped (the stdio one sees every
tool call, the hook only the start and the end), so a session never arrives
twice. Clients the plugin does not reach have no hooks; for them stdio remains the only carrier.

## What the plugin's hooks send

The Claude Code plugin (0.1.5 and later) runs command hooks: plain processes,
no model call, talking to nothing but your todox server's `/api/rpc` with the
token you gave the plugin. Every call carries `x-todox-carrier:
claude-code-hook`, so it is counted under `hook:<method>` and never as your
agent's call (see below). The Codex hooks are the same script and send the same
header; the name predates them.

| Hook | Sends | When |
|---|---|---|
| SessionStart | `getContext` with your `cwd`, the repository's `origin` URL (credentials stripped), `shape: "digest"`, `create_if_missing: false` | startup, resume, `/clear`, after compaction |
| Stop | `sessionStatus` with your `cwd` and a window of hours | only if this session touched a todox task |
| PreCompact (Claude Code only) | `sessionStatus`, the same call as Stop | before compaction, only if this session touched a todox task |
| Stop, SessionEnd | `recordObservation`: the `origin` URL, branch, two commit ids, commit and dirty-file counts, up to three commit subjects, ids of tasks set to `doing` | only if git changed since the last one sent |

The remote is there so a second checkout of a repository todox already knows,
at a path it has not seen, finds its project; it only ever resolves one, never
registers one. Nothing else leaves your machine: no diff, no file path beyond
the working directory you were already sending, no prompt, no transcript. What the hooks
remember between calls — which tasks this session touched, whether it edited
files, whether it was already stopped once — stays in a file per session under
the plugin's data directory, deleted after seven days. So do their errors, in
`hook.log` (rotated at 64 KB), which records an event name and an error message
and never the token or a response body.

`TODOX_HOOKS=off` turns every hook off; `TODOX_STOP=off` only the Stop hook's
request for a handoff; `TODOX_OBSERVE=off` only the observation.

## What the git hook sends

`todox-mcp hook install` (0.1.6 and later) is the third carrier, for any client
or none: a block in one repository's `post-commit` and `post-rewrite` hooks that
runs `~/.todox/git-hook.mjs` detached, after git has already made the commit.

| When | Sends |
|---|---|
| After a commit, and once after a rebase or amend | `recordObservation`: the repository's `origin` URL (credentials stripped, so a second checkout finds its project), branch, two commit ids, commit and dirty-file counts, up to three commit subjects, `source: "git-hook"` |

Each machine, branch and day is one row (`session_id` is `git:` + a short hash
of the host name + branch + date), so a day of commits updates one observation
rather than adding one per commit. A rebase's replayed commits are not sent one
by one. The server drops the write while the stdio process or the Claude Code
plugin has written for the same project in the last 30 minutes, since a commit
inside an agent's session belongs to that session's row; and it never registers
a project — a repository todox does not know yet is logged and skipped.

What it keeps between commits — the day's base commit and the last state sent
— sits in the repository's own git directory (`todox-observe.json`), never in
the working tree. Its token is in `~/.todox/config.json` (mode 0600) unless
`TODOX_TOKEN` is set, and its errors in `~/.todox/git-hook/hook.log`. Calls are
counted as `hook:recordObservation`. `TODOX_OBSERVE=off` or `TODOX_HOOKS=off`
turns it off; `todox-mcp hook uninstall` removes it.

## What the server counts

The server keeps a count of which methods were called, per account, per day —
a method name, how many calls, how many were refused, and the first and last
time on that day. Nothing else: no parameters, no bodies, no paths, no project
or task ids. `pnpm usage` reads it back.

It exists because of a question the rest of the measurement cannot answer.
`pnpm funnel` sees an account arrive, mint a token and come back on a later
day; what it cannot see is an agent that opens every session, reads the
briefing and writes nothing — which is the difference between a tool being
connected and a tool being used, and it is invisible from the outside.

Counts rather than events, and that is the point rather than an optimisation:
one row per account per method per day is bounded by construction, so there is
no event log accumulating beside the log you actually keep, and nothing to
expire. On a self-hosted instance these rows are in your own database like
everything else, and `TODOX_OBSERVE=off` does not touch them — it is a
different mechanism, on the client rather than the server.

A call that a client-side hook placed on the agent's behalf — the Claude Code
plugin's session-start briefing, its check before a session stops — carries an
`x-todox-carrier: claude-code-hook` header and is counted as `hook:<method>`:
still a method name and nothing else, but not an agent's. `pnpm usage` marks
those rows as the client's own, and the nudge for an account that has gone
quiet does not count them.
