# todox MCP — client-side rules

These four lines are the user-scope contract. Paste them into whatever file
your client reads as global instructions.

1. Before planning any non-trivial work, call `get_context` with `cwd` set to
   the absolute path of the directory you are working in. It registers the
   project on first call and returns the briefing for that session.

2. On every RPC method (writes and reads), pass `model` with your own model
   id. Writes record it on the row; reads use it as telemetry.

3. When work that will not finish this session comes up, call `create_task`
   with `cwd` and the goal in `body`. Status moves with `update_task`.

4. Before stopping, call `log_entry(kind:'handoff')` on every task you
   touched, and `log_entry(kind:'dead_end')` for every approach that did not
   work. The next session is the consumer; write for them, not for yourself.

## Install

Run `pnpm install:mcp <client>` once and the CLI writes the right config file
and verifies the connection. `<client>` is one of:
`claude-code`, `codex`, `cursor`, `vscode`, `opencode`.

If you install by hand, the JSON / TOML shape per client is documented in
`scripts/install-mcp/clients/`.
