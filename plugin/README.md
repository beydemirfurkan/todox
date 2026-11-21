# todox for Claude Code

The todox MCP server, the session protocol as a skill, and one reminder at
session start — packaged so that installing it is one command and nothing has
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

What it deliberately does not add: a `Stop` hook. A prompt hook at stop cannot
read the transcript — it sees the last message and nothing else — so it either
blocks every chat that ends without a handoff or blocks none. The shape that
would work is an agent hook that reads the transcript, and that is a model call
on every stop. `session_status` at the end of the instructions, named again at
session start, is the reminder; the enforcement is a measured question, not a
default.

From a clone, without installing: `claude --plugin-dir ./plugin`.
