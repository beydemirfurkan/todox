# todox — Copilot workspace instructions

This repository's agent rules live in `AGENTS.md` (read first) and
`CLAUDE.md` (which imports `AGENTS.md` and `CONTRIBUTING.md`). Cross-file
workflows (RPC method additions, SQL changes, i18n, UI conventions) are
documented in `.claude/skills/<name>/SKILL.md` — read the relevant one
before changing those areas.

If the todox MCP server is connected, call `get_context` with `cwd`
before planning non-trivial work, and `log_entry(kind: "handoff")` before
stopping. Otherwise skip these.
