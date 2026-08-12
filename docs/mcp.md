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
| `--dry-run` | off | plan only, nothing written |
| `--verbose` | off | platform, node version and resolved home |

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

```bash
pnpm mcp:doctor https://www.todox.dev/api/mcp todox_…
```

`initialize`, then `tools/list`, then a real `get_context` call — so auth,
schema and project resolution are all exercised rather than assumed. The
install CLI runs the same pass at the end of an `http` install.

If you install by hand, the JSON / TOML shape per client is documented in
`scripts/install-mcp/clients/`, and the per-platform paths are in the README's
"Connect an agent" section.
