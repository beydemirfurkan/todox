---
name: add-rpc-method
description: Use when adding, renaming or removing a todox RPC method or MCP tool — anything an agent can call. Covers the order the six files have to be touched in, and what breaks when one is missed.
---

# Adding an RPC method

Every agent-facing capability is the same six-file change. The order matters:
the schema is the contract, and the handler will not compile without it.

## 1. Schema — `lib/services/rpc-schemas.ts`

Add the parameter shape to `SHAPES`. This is the runtime contract *and* the MCP
tool surface: `mcp/server.ts` imports the same object, so a tool cannot
advertise an argument the server rejects.

- `.describe()` text is read by a model deciding whether to call the tool. Write
  it for that reader, not for a human skimming types.
- Objects are built `.strict()` in `OBJECTS`, so unknown keys are an error
  rather than something a repository has to defend against.
- If the method is a patch, add a `.refine()` next to `updateTask` /
  `updateProject` requiring at least one field. A patch of nothing used to
  return the unchanged row, which reads to an agent exactly like a success.
- Fields a local process can fill in itself (`repo_root`, `tz`) go in the schema
  and are hidden from the model **only in local mode** (`LOCAL_INTERNAL` in
  `mcp/tools.ts`). Hosted, nobody but the agent knows them, so they are
  advertised and the `.describe()` text has to tell it what to send.

## 2. Handler — `lib/services/rpc.ts`

Add it to `methods`. The object is `satisfies Record<MethodName, …>` and
`MethodName` comes from the keys of `SHAPES`, so a handler without a schema is a
compile error — that is the guardrail, keep it.

The handler signature is TypeScript and is erased at build time. It guards
nothing. Validation happened in step 1.

## 3. Where the work lives

- One table → a repository in `lib/repositories/`.
- More than one table, or anything that must stay consistent across tables (a
  status change writing a `task_events` row) → `lib/services/`.
- **Repositories never call each other.**
- Ownership is asserted in exactly one place: `lib/services/ownership.ts`. Do
  not inline `WHERE user_id = ?` at the call site. A row belonging to somebody
  else answers **404**, never 403.

## 4. Tool registration — `mcp/tools.ts` (both transports)

One definition serves the hosted endpoint (`app/api/mcp/route.ts`) and the
stdio process (`mcp/server.ts`). Register with the `tool()` helper; it pulls the
input schema from `SHAPES`, so do not restate it. Use the options when the model
should not be filling something in itself:

- `overrides` — advertise a friendlier shape (`create_task` takes plain paths
  and this side attaches the hashes; a model cannot invent a sha256).
- `prepare` — last chance to add what only this side knows.
- `after` — runs on the result and may call back (`checkLinkedFiles`).
- `transform` / `presentation` — rendering that belongs on this side.

**Anything that needs a disk goes through `Workspace`** — `hash`, `repoRoot`,
`tz`, `checkRefs`. The hosted server answers all of them with `null`/`undefined`
and the tool must **degrade, not fail**: record what it was given and let the
status fall to `unknown`. Never let one side claim a file is unchanged when it
could not read it.

If the tool changes what an agent should do at session start or before
finishing, update `BASE` in the same file — and if the advice differs by mode,
`LOCAL_NOTE` / `REMOTE_NOTE`.

## 5. README

`README.md` has a table of tools under "Connect an agent". A tool that is not in
it does not exist as far as a reader is concerned.

## 6. Test

`lib/services/rpc-schemas.test.ts` — assert the params that must be rejected.
These tests need no database, so they run in CI on every push.

`pnpm smoke:mcp` runs the whole agent surface through both transports against a
live server. If a tool only works one way in, that is where it shows.

## Before you call it done

```bash
pnpm lint && pnpm test && pnpm build && pnpm exec tsc --noEmit
```

`tsc --noEmit` is the one that covers `mcp/` and `scripts/`; the build does not.

The rules above are the short version of [CONTRIBUTING.md](../../../CONTRIBUTING.md).
