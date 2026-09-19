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
- **SessionStart hook** — one sentence into the session's context: read the log
  first, and before finishing call `session_status` and write up what it names.

What it deliberately does not add: a `Stop` hook. A prompt hook at stop cannot
read the transcript — it sees the last message and nothing else — so it either
blocks every chat that ends without a handoff or blocks none. The shape that
would work is an agent hook that reads the transcript, and that is a model call
on every stop. `session_status` at the end of the instructions, named again at
session start, is the reminder; the enforcement is a measured question, not a
default.

From a clone, without installing: `claude --plugin-dir ./plugin`.
