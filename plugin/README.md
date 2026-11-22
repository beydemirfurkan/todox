# todox for Claude Code

The todox MCP server, the session protocol as a skill, and command hooks that
brief a session at start and ask for its handoff at the end — packaged so that
installing it is one command and nothing has
to be pasted into a config file by hand.

```bash
claude plugin marketplace add beydemirfurkan/todox
claude plugin install todox@todox
```

It asks for your agent token once (Account page on todox.dev, or your own
instance) and keeps it in your Claude Code settings, not in the plugin.

What it adds:

- **MCP server** — `https://www.todox.dev/api/mcp` with your token. Self-hosting?
  Edit `.mcp.json`'s `url`, or use `pnpm install:mcp claude-code --url …` from a
  clone instead of this plugin.
- **Skill `todox`** — the same text the server sends at `initialize`, loaded by
  Claude Code when a session starts, when something worth keeping comes up and
  when a session is ending. Generated from `mcp/tools.ts` by `pnpm plugin:sync`;
  `plugin.test.ts` fails when it drifts.
- **SessionStart hook** — the project's briefing as a digest (under Claude
  Code's 10,000-character limit for hook context), fetched with your token
  before the MCP connection is even up, and fetched again after `/compact`, which
  is where a long session forgets what it read at the start. It never registers
  a project: in a directory todox does not know yet, or with no token, todox
  unreachable or no `node` on the machine, it falls back to one sentence — read
  the log first, and before finishing call `session_status` and write up what
  it names.

The hooks are command hooks: one node script with no dependencies
(`hooks/todox-hook.mjs`, generated from `mcp/hook/` by `pnpm plugin:sync`), no
model call, nothing sent anywhere but todox's own `/api/rpc`, and every call
marked as a hook's so the server does not count it as the agent's. Every
failure exits 0 and leaves a line in `hook.log` under the plugin's data
directory, never in the session. `TODOX_HOOKS=off` turns them all off;
`TODOX_URL` points them at another server when `.mcp.json`'s `url` was
overwritten by an update.

- **Stop hook** — asks for the handoff, **once per session**, and only for
  tasks this session itself created or wrote on that are still `doing` or have
  changed since their last handoff — asked of the server with `session_status`,
  not guessed. The turn is stopped with the exact calls to make and "if the
  developer asked to stop now, say so and stop." A session that only read is
  never stopped. One that edited files without touching any todox task gets a
  single message to you, not a stop: a typo fix owes no task, and a hook that
  blocks every quick fix makes capture more expensive, which is the trade-off
  this project weighs hardest. `TODOX_STOP=strict` makes that a stop too;
  `TODOX_STOP=off` turns the Stop hook off; "no-handoff" or "todox off" in a
  prompt turns it off for that session.

- **PreCompact hook** — compaction is where a long session loses the detail
  its handoff would have been written from. Claude Code reads this hook's
  output as instructions for the compaction summary, so it names the tasks
  this session touched that still owe a write-up (the same `session_status`
  question the Stop hook asks), asks the summary to keep each one's status,
  decisions, failed approaches and next step, and to carry the instruction to
  write them up right after compaction. It never blocks a compaction, says
  nothing for a session that is written up or only read, and honours the same
  `TODOX_STOP=off` and "no-handoff".

An earlier version of this README argued against a Stop hook: a prompt hook at
stop sees only the last message, so it blocks every chat or none, and an agent
hook that reads the transcript is a model call on every stop. Both are true and
neither is what this is. A command hook is a plain process: a `PostToolUse`
hook appends one line per edit or todox call to a file under the plugin's data
directory, and at stop the question "did this session leave its own tasks
unwritten?" is one RPC, with no transcript and no model.

From a clone, without installing: `claude --plugin-dir ./plugin`.
