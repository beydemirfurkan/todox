# MCP Install Friction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the time an agent spends installing todox MCP to a single command, and let the server tell agents the rules of the client they're actually on so the four-line "use get_context first / leave a handoff" contract lands in every session — including the ones that previously fell through the cracks.

**Architecture:** Three layered changes. (1) Lift the `model` parameter out of the four methods that already declare it and put it on every method's shape, so the agent's "always pass your model id" rule holds uniformly. (2) Ship an `install-mcp` CLI in `scripts/install-mcp/` — one entry point that knows each client's native config format, including the Claude Code `--header` greedy-arg bug we hit twice. (3) Capture `clientInfo` from the MCP `initialize` handshake, key it on the bearer token, and inject client-specific notes into the `get_context` briefing — so Claude Code hears it needs a `~/.claude/CLAUDE.md` even when no one told it, and Codex hears it doesn't.

**Tech Stack:** TypeScript, Node ≥22, `tsx`, `zod` (already), `@modelcontextprotocol/sdk` (already), `vitest` (already). No new runtime dependencies.

---

## Global Constraints

- TypeScript strict; no `any` (use `unknown` + type guard); no `as` except where inevitable; explicit return types on public APIs (`tsconfig.json`).
- Repository rules in `AGENTS.md` are authoritative. In particular: cross-table logic in `lib/services/`, single-table reads/writes in `lib/repositories/`, every RPC method has a Zod schema, never build a `SET` clause by hand, the server never touches the filesystem.
- No auto-commit. One logical change per commit. Conventional Commits. Conventional branches `<type>/<short-description>`.
- Conventional comments only as the last resort; reach for a name first. No restating-the-diff comments. No commented-out code.
- MCP tool descriptions are written for a model. New arguments get a `.describe(...)`.
- Both `lib/i18n/en.ts` and `lib/i18n/tr.ts` keys stay in sync — a missing translation fails `lib/i18n/index.test.ts`.
- Shell from PowerShell 7+. The plan uses POSIX-style in code; run via `pnpm tsx ...` so the shell layer doesn't matter.
- Windows path handling: `%APPDATA%\Code\User\mcp.json` (backslashes), `~/.config/opencode/opencode.json` (forward slashes). Use `path.join` / `path.resolve`; never concatenate paths by hand.
- Token is a secret. Never log it, never commit it, never echo it in `pnpm install:mcp` output. Default placeholder in user-scope config writes is `<TODOX_TOKEN>` — caller substitutes from `TODOX_TOKEN` env or `--token`.
- Production server URL: `https://www.todox.dev`. Default for the install command.

---

## File Structure

```
lib/
  services/
    rpc-schemas.ts            MOD  Add `model,` to every method shape; add
                              `recordClientInfo` method. Export `MAX`
                              unchanged.
    rpc-schemas.test.ts       MOD  Behaviour-level test using parseParams.
    rpc.ts                    MOD  Add `recordClientInfo` handler (single
                              repository call).
  server/
    client-info.ts            NEW  DB-backed record/lookup keyed on token
                              hash. Replaces the in-memory cache from the
                              earlier draft -- the HTTP path is stateless and
                              Vercel cold starts reset any per-instance Map.
  repositories/
    api-tokens.ts             MOD  Add `recordClientUse(tokenHash, name, version)`
                              and `lastClientUse(tokenHash)`.
  db/
    schema.ts                 MOD  Three new columns on `api_tokens`:
                              last_client_name, last_client_version,
                              last_client_seen_at.

mcp/
  server.ts                   MOD  At startup, read TODOX_CLIENT_NAME /
                              TODOX_CLIENT_VERSION from env, call
                              `recordClientInfo` once.
  tools.ts                    MOD  `Workspace` gets `bearerToken: () => string |
                              undefined`. `get_context` transform reads the
                              token and appends the client-specific notes.

app/
  api/
    mcp/
      route.ts                MOD  After auth, capture `clientInfo` from the
                              JSON-RPC `initialize` body and call
                              `recordClientInfo` once per request.

scripts/
  install-mcp/                NEW
    index.ts                        CLI entry. Argv parsing, install + verify
                                    per client.
    clients/
      types.ts                       `ClientInstaller` interface + `InstallResult`.
      paths.ts                       Path resolvers (Windows %APPDATA%, XDG
                                    config dir, ~-expansion). No I/O beyond
                                    reading env.
      atomic-write.ts                JSON read/write with write-to-tmp +
                                    rename. Two installers racing still
                                    produce a whole file -- one rename wins,
                                    the other retries -- but a true
                                    read-modify-write lock is out of scope
                                    here (installations are user-initiated
                                    and serial in practice).
      toml.ts                        Hand-rolled `[mcp_servers.<name>]` block
                                    upsert + `tomlString` escape.
      claude-code.ts                 Native `claude mcp add` if `claude` is on
                                    PATH; fallback to `~/.claude.json` writer.
                                    Header ordering workaround documented.
      codex.ts                       `~/.codex/config.toml` writer. Hand-rolled
                                    TOML serialiser (one section + one
                                    [[headers]] table; no library).
      cursor.ts                      `~/.cursor/mcp.json` writer.
      vscode.ts                      `%APPDATA%\Code\User\mcp.json` (Win) /
                                    `~/.config/Code/User/mcp.json` (POSIX).
                                    Root key is `servers`, not `mcpServers`.
      opencode.ts                    `~/.config/opencode/opencode.json` writer;
                                    stdio transport by default (process is
                                    local, no need to hit the network).
    doctor.ts                        Standalone — `initialize` + `tools/list` +
                                    `get_context({cwd})` against a URL+token;
                                    prints a 4-line report.
    install-mcp.test.ts              Vitest: argv parser unit tests.
    clients/
      claude-code.test.ts            Round-trip JSON config; native-CLI path is
                                    mocked.
      codex.test.ts                  Round-trip TOML: header ordering,
                                    escaping of quotes in token (Bearer tokens
                                    can contain `_` and `-`; never `"`).
      cursor.test.ts
      vscode.test.ts
      opencode.test.ts
      paths.test.ts                  expandHome, vsCodeConfigDir (Win + POSIX).
      atomic-write.test.ts           readJsonFile/writeJsonFile round-trip +
                                    single-write race smoke.
      toml.test.ts                   upsertTomlServerSection create / update /
                                    escape (quotes + backslashes).

package.json                  MOD  Add `install:mcp` and `mcp:doctor` scripts.

docs/
  mcp.md                      NEW  Client-facing install guide. Each client
                              gets: one-liner, copy-paste command, expected
                              output, troubleshooting.
```

The `lib/server/` directory is new; the `client-info` store would have lived inline in `app/api/mcp/route.ts`, but the AGENTS rule "tests live beside the code they exercise" plus "the agent surface is defined once" argues for a tiny named unit. Both `mcp/server.ts` (stdio) and `app/api/mcp/route.ts` (HTTP) import from it.

`docs/superpowers/plans/2026-08-12-mcp-install-friction.md` is this file; the skill writes here.

---

## Task 1: `model` is accepted on every RPC method

**Files:**
- Modify: `lib/services/rpc-schemas.ts:90-285` (the `SHAPES` object — add `model,` to every method that lacks it)
- Modify: `lib/services/rpc-schemas.test.ts` (new test cases at the end of the file)

**Interfaces:**
- Consumes: the existing `model` Zod helper at `lib/services/rpc-schemas.ts:45-49`
- Produces: every method in `SHAPES` includes a `model?: string` field, so any caller may pass it; the server's per-method `.strict()` validator (lines 314-350) accepts it

**Why:** The agent rule "always pass your model id on writes" was written before `get_context` carried a model field. Today `get_context` rejects `model` outright (`.strict()` is on, line 326). Adding it to every shape lets the agent apply the rule uniformly — including on read calls, where the field becomes a telemetry breadcrumb instead of being silently dropped or rejected.

- [ ] **Step 1: Write the failing test**

Append to `lib/services/rpc-schemas.test.ts`:

```ts
import { parseParams } from "./rpc-schemas";

/**
 * Behaviour, not presence: `parseParams` runs both the SHAPES layer and the
 * per-method `.strict()` wrapper in lib/services/rpc-schemas.ts, so an
 * `expect("model" in SHAPES.x])` test would silently pass even if a future
 * regression tightened `.strict()` and the method kept the field. Parsing
 * with `model` in the input exercises both layers in one call.
 */
describe("model field round-trips through parseParams on every method", () => {
  // Minimal payload per method -- enough to satisfy required fields without
  // pulling in fakes for ref shapes.
  const fixtures: Record<string, Record<string, unknown>> = {
    listProjects: {},
    listTasks: { project: "x" },
    getContext: { cwd: "/tmp" },
    getTask: { task_id: 1 },
    createProject: { name: "x" },
    updateProject: { project: "x", summary: "y" },
    deleteProject: { project: "x", confirm: "x" },
    createTask: { title: "x" },
    updateTask: { task_id: 1, status: "doing" },
    logEntry: { task_id: 1, kind: "note", body: "x" },
    linkFiles: { task_id: 1, paths: [{ path: "/tmp/x" }] },
    reportRefs: { refs: [{ id: 1, hash: "a".repeat(64) }] },
    addContext: { kind: "convention", title: "x", body: "x" },
    search: { query: "x" },
    activityReport: { period: "today" },
  };

  for (const [method, base] of Object.entries(fixtures)) {
    it(`${method} accepts { ...base, model: "test" }`, () => {
      const out = parseParams(method, { ...base, model: "test-model" });
      expect(out.model).toBe("test-model");
    });

    it(`${method} still rejects an unknown key`, () => {
      // The shape gained a field; .strict() must not have been relaxed.
      expect(() => parseParams(method, { ...base, bogus_key: 1 })).toThrow();
    });
  }
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm test -- lib/services/rpc-schemas.test.ts`
Expected: failures for every method that lacks `model`: `listProjects`, `listTasks`, `getContext`, `getTask`, `createProject`, `updateProject`, `deleteProject`, `createTask`, `linkFiles`, `reportRefs`, `addContext`, `search`, `activityReport`. (`updateTask` and `logEntry` already have `model` and will pass on the first half of each pair; their "rejects unknown key" half stays green either way.)

- [ ] **Step 3: Add `model,` to the methods that lack it**

In `lib/services/rpc-schemas.ts`, edit each method body in `SHAPES` to end with a `model,` line. Specifically:

- `listProjects` (line 90, currently `{}`): change to `{ model, }`
- `listTasks` (~line 91): add `model,` at the end
- `createProject` (line 92): add `model,` after `summary`
- `updateProject` (line 109): add `model,` after `summary`
- `deleteProject` (line 126): add `model,` at the end
- `getContext` (line 136): add `model,` after `repo_root`
- `createTask` (line 172): add `model,` after `files`
- `getTask`, `linkFiles`, `reportRefs`, `addContext`, `search`, `activityReport`: add `model,` to each

Reference: the `model` helper at lines 45-49. Pattern (copy verbatim):

```ts
model,
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test -- lib/services/rpc-schemas.test.ts`
Expected: 28/28 green (14 methods × 2 assertions each).

- [ ] **Step 5: Run lint + typecheck**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Update the `BASE` instructions in `mcp/tools.ts`**

Replace lines 93-95 of `mcp/tools.ts`:

```ts
  "ALWAYS pass `model` with your own model id on create_task, update_task and",
  "log_entry. It costs you nothing and it is how the developer can later show",
  "which work was done by which model.",
```

with:

```ts
  "ALWAYS pass `model` with your own model id on every method — write tools",
  "record it on the row, read tools use it as telemetry so the developer can",
  "later see which work was done by which model.",
```

- [ ] **Step 7: Commit**

```bash
git checkout -b feat/schema-model-on-all-methods
git add lib/services/rpc-schemas.ts lib/services/rpc-schemas.test.ts mcp/tools.ts
git commit -m "feat(schema): accept model on every RPC method"
```

---

## Task 2: `scripts/install-mcp/clients/types.ts` — the shared contract

**Files:**
- Create: `scripts/install-mcp/clients/types.ts`
- Create: `scripts/install-mcp/clients/paths.ts`
- Create: `scripts/install-mcp/clients/paths.test.ts`
- Create: `scripts/install-mcp/clients/atomic-write.ts`
- Create: `scripts/install-mcp/clients/atomic-write.test.ts`
- Create: `scripts/install-mcp/clients/toml.ts`
- Create: `scripts/install-mcp/clients/toml.test.ts`

**Interfaces:**
- Consumes: nothing — this is the dependency root for every installer
- Produces: a `ClientInstaller` interface every later client file implements

- [ ] **Step 1: Create `scripts/install-mcp/clients/types.ts`**

```ts
/**
 * One client, one install strategy. The CLI dispatches on `name` to the
 * matching installer; each file owns its own config-file format and quirks.
 *
 * `install` is idempotent: a second call against an already-configured client
 * must not duplicate the entry — replace by `name`, leave other entries alone.
 */
export type ClientInstaller = {
  /** Canonical name, used in argv (`todox install-mcp <name>`) and in tests. */
  readonly name: string;
  /** Does the user's machine appear to host this client? Cheap filesystem check. */
  detect(): Promise<boolean>;
  /**
   * Write or update the config. Returns the path touched and whether the entry
   * was newly created or replaced. Must throw on permission errors so the CLI
   * can show the user something actionable.
   */
  install(input: {
    transport: "http" | "stdio";
    url: string;
    token: string;
  }): Promise<{ path: string; status: "created" | "updated"; entryId: string }>;
  /**
   * Read back what `install` wrote. Returns ok=false when the config is
   * missing the entry — the CLI turns that into "install failed" rather than
   * "install succeeded but verify failed".
   */
  verify(): Promise<{ ok: boolean; detail: string }>;
};
```

- [ ] **Step 2: Create `scripts/install-mcp/clients/paths.ts`**

```ts
import * as os from "node:os";
import * as path from "node:path";

/**
 * `~` on Windows is `%USERPROFILE%`, on POSIX it's `$HOME`. The MCP client
 * config files store `~` literally (every client we tested expanded it
 * itself), so we expand here so the file we write is unambiguous.
 */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\"))
    return path.join(os.homedir(), p.slice(2));
  return p;
}

/** `%APPDATA%\Code\User\` on Windows, `~/.config/Code/User/` elsewhere. */
export function vsCodeConfigDir(): string {
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appdata, "Code", "User");
  }
  return path.join(os.homedir(), ".config", "Code", "User");
}
```

- [ ] **Step 3: Create `scripts/install-mcp/clients/atomic-write.ts`**

```ts
import { promises as fs } from "node:fs";
import * as path from "node:path";

/**
 * Read JSON if it exists; treat parse failure as "not configured". Caller
 * decides what to merge.
 */
export async function readJsonFile<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Write to `<file>.tmp` then rename. Two installers racing still produce a
 * whole file -- one rename wins, the other retries. A true
 * read-modify-write lock is out of scope: installations are user-initiated
 * and serial in practice, and the alternative (a `proper-lockfile` dep) is
 * not worth its weight for a CLI.
 */
export async function writeJsonFile(p: string, value: unknown): Promise<void> {
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  const data = JSON.stringify(value, null, 2);
  await fs.writeFile(tmp, data, { encoding: "utf8" });
  await fs.rename(tmp, p);
}
```

- [ ] **Step 4: Create `scripts/install-mcp/clients/toml.ts`**

```ts
/**
 * Append or replace a `[mcp_servers.<name>]` section. Used by the Codex
 * installer. Hand-rolled because the table we emit is small: one section
 * header, one `url` line, one `http_headers` table. Pulling in a TOML
 * dependency for that is not worth it.
 */
export function upsertTomlServerSection(
  text: string,
  name: string,
  fields: { url: string; headerName: string; headerValue: string },
): { text: string; status: "created" | "updated" } {
  const header = `[mcp_servers.${name}]`;
  const block = [
    header,
    `url = ${tomlString(fields.url)}`,
    "",
    `[mcp_servers.${name}.http_headers]`,
    `${tomlString(fields.headerName)} = ${tomlString(fields.headerValue)}`,
    "",
  ].join("\n");

  if (text.includes(`${header}\n`) || text.startsWith(header)) {
    const re = new RegExp(`${escapeRegExp(header)}\\n[\\s\\S]*?(?=\\n\\[|\\Z)`, "m");
    const updated = text.replace(re, block.trimEnd() + "\n");
    return { text: updated, status: "updated" };
  }
  const sep = text.endsWith("\n") || text.length === 0 ? "" : "\n";
  return { text: text + sep + "\n" + block, status: "created" };
}

function tomlString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 5: Create the three test files**

`scripts/install-mcp/clients/paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as os from "node:os";
import * as path from "node:path";

import { expandHome, vsCodeConfigDir } from "./paths";

describe("expandHome", () => {
  it("expands ~ on its own", () => {
    expect(expandHome("~")).toBe(os.homedir());
  });
  it("expands ~/path", () => {
    expect(expandHome("~/foo")).toBe(path.join(os.homedir(), "foo"));
  });
  it("leaves absolute paths alone", () => {
    expect(expandHome("/etc/passwd")).toBe("/etc/passwd");
  });
});

describe("vsCodeConfigDir", () => {
  it("uses APPDATA on win32", () => {
    const saved = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    process.env.APPDATA = "C:\\Users\\x\\AppData\\Roaming";
    try {
      expect(vsCodeConfigDir()).toBe("C:\\Users\\x\\AppData\\Roaming\\Code\\User");
    } finally {
      Object.defineProperty(process, "platform", { value: saved, configurable: true });
    }
  });
  it("uses ~/.config on linux", () => {
    const saved = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      expect(vsCodeConfigDir()).toBe(path.join(os.homedir(), ".config", "Code", "User"));
    } finally {
      Object.defineProperty(process, "platform", { value: saved, configurable: true });
    }
  });
});
```

`scripts/install-mcp/clients/atomic-write.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { readJsonFile, writeJsonFile } from "./atomic-write";

describe("readJsonFile / writeJsonFile", () => {
  it("returns null for missing file", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "todox-aw-"));
    expect(await readJsonFile(path.join(dir, "absent.json"))).toBeNull();
  });
  it("round-trips an object", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "todox-aw-"));
    const file = path.join(dir, "cfg.json");
    await writeJsonFile(file, { a: 1, b: ["x"] });
    expect(await readJsonFile(file)).toEqual({ a: 1, b: ["x"] });
  });
  it("survives concurrent single-writes (no torn file)", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "todox-aw-"));
    const file = path.join(dir, "race.json");
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => writeJsonFile(file, { who: i })),
    );
    const out = await readJsonFile<{ who: number }>(file);
    expect(typeof out?.who).toBe("number");
  });
});
```

`scripts/install-mcp/clients/toml.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { upsertTomlServerSection } from "./toml";

describe("upsertTomlServerSection", () => {
  it("creates a section when none exists", () => {
    const out = upsertTomlServerSection("", "todox", {
      url: "https://www.todox.dev/api/mcp",
      headerName: "Authorization",
      headerValue: "Bearer abc",
    });
    expect(out.status).toBe("created");
    expect(out.text).toContain("[mcp_servers.todox]");
    expect(out.text).toContain('url = "https://www.todox.dev/api/mcp"');
    expect(out.text).toContain("[mcp_servers.todox.http_headers]");
    expect(out.text).toContain('"Authorization" = "Bearer abc"');
  });

  it("replaces an existing section in place", () => {
    const first = upsertTomlServerSection("", "todox", {
      url: "https://old.example/mcp",
      headerName: "Authorization",
      headerValue: "Bearer old",
    });
    const second = upsertTomlServerSection(first.text, "todox", {
      url: "https://new.example/mcp",
      headerName: "Authorization",
      headerValue: "Bearer new",
    });
    expect(second.status).toBe("updated");
    expect(second.text).not.toContain("old.example");
    expect(second.text).toContain("new.example");
    expect(second.text).toContain("Bearer new");
  });

  it("escapes quotes inside the header value", () => {
    const out = upsertTomlServerSection("", "todox", {
      url: "https://x/mcp",
      headerName: "Authorization",
      headerValue: 'Bearer "quoted"',
    });
    expect(out.text).toContain('Bearer \\"quoted\\"');
  });

  it("escapes backslashes inside the header value", () => {
    const out = upsertTomlServerSection("", "todox", {
      url: "https://x/mcp",
      headerName: "Authorization",
      headerValue: "Bearer back\\slash",
    });
    expect(out.text).toContain('Bearer back\\\\slash');
  });
});
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test -- scripts/install-mcp/clients/paths.test.ts scripts/install-mcp/clients/atomic-write.test.ts scripts/install-mcp/clients/toml.test.ts`
Expected: 12 green (paths 5, atomic-write 3, toml 4).

- [ ] **Step 7: Commit**

Branch: `feat/install-mcp-types-paths-atomic-write-toml`.

```bash
git checkout -b feat/install-mcp-types-paths-atomic-write-toml
git add scripts/install-mcp/clients/types.ts scripts/install-mcp/clients/paths.ts scripts/install-mcp/clients/atomic-write.ts scripts/install-mcp/clients/toml.ts scripts/install-mcp/clients/paths.test.ts scripts/install-mcp/clients/atomic-write.test.ts scripts/install-mcp/clients/toml.test.ts
git commit -m "feat(install-mcp): split utils into paths/atomic-write/toml"
```

---

## Task 3: Claude Code installer (`scripts/install-mcp/clients/claude-code.ts`)

**Files:**
- Create: `scripts/install-mcp/clients/claude-code.ts`
- Create: `scripts/install-mcp/clients/claude-code.test.ts`

**Interfaces:**
- Consumes: `ClientInstaller` from Task 2
- Produces: a module exporting `client: ClientInstaller` with `name = "claude-code"`

**Why:** Claude Code is the client where the `--header` greedy-arg bug bit us. The native CLI is the cleanest path when it works; the JSON fallback handles older versions and CI.

- [ ] **Step 1: Create `scripts/install-mcp/clients/claude-code.ts`**

```ts
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { readJsonFile, writeJsonFile } from "./atomic-write";
import type { ClientInstaller } from "./types";

const CONFIG_PATH = path.join(os.homedir(), ".claude.json");
const NAME = "todox";

async function claudeOnPath(): Promise<boolean> {
  return new Promise((resolve) => {
    const cmd = process.platform === "win32" ? "where" : "which";
    const p = spawn(cmd, ["claude"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

async function installViaNativeCli(url: string, token: string): Promise<boolean> {
  if (!(await claudeOnPath())) return false;
  return new Promise((resolve) => {
    // Note the order: `name` first, then `--transport http` and the URL, then
    // `--header` and its KEY and VALUE as separate args. The greedy-parser
    // bug fires when KEY and VALUE are joined ("Authorization=Bearer ...")
    // and the parser sees one positional arg -- the fix is to keep them
    // separate.
    const args = [
      "mcp",
      "add",
      NAME,
      "--transport",
      "http",
      url,
      "--header",
      "Authorization",
      `Bearer ${token}`,
    ];
    const p = spawn("claude", args, { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

async function installViaJson(url: string, token: string): Promise<{ status: "created" | "updated" }> {
  const current = (await readJsonFile<Record<string, unknown>>(CONFIG_PATH)) ?? {};
  const servers = (current.mcpServers as Record<string, unknown>) ?? {};
  const existed = NAME in servers;
  servers[NAME] = {
    type: "http",
    url,
    headers: { Authorization: `Bearer ${token}` },
  };
  current.mcpServers = servers;
  await writeJsonFile(CONFIG_PATH, current);
  return { status: existed ? "updated" : "created" };
}

export const client: ClientInstaller = {
  name: "claude-code",
  async detect() {
    if (await claudeOnPath()) return true;
    try {
      await fs.access(CONFIG_PATH);
      return true;
    } catch {
      return false;
    }
  },
  async install({ transport, url, token }) {
    if (transport !== "http") {
      throw new Error("claude-code currently supports the http transport only; pass --transport http");
    }
    // Try the native CLI first. On success it has written the same entry
    // shape, and we MUST NOT also write via JSON -- doing so would clobber
    // any extra fields the CLI set (a future-proofing path, custom env, etc.)
    // and is a needless second write.
    const nativeOk = await installViaNativeCli(url, token);
    if (nativeOk) return { path: CONFIG_PATH, status: "updated", entryId: "native" };
    const { status } = await installViaJson(url, token);
    return { path: CONFIG_PATH, status, entryId: "json" };
  },
  async verify() {
    const cfg = await readJsonFile<{ mcpServers?: Record<string, unknown> }>(CONFIG_PATH);
    const entry = cfg?.mcpServers?.[NAME];
    if (!entry) return { ok: false, detail: `no mcpServers.${NAME} in ${CONFIG_PATH}` };
    const headers = (entry as { headers?: Record<string, string> }).headers ?? {};
    if (!String(headers.Authorization ?? "").startsWith("Bearer ")) {
      return { ok: false, detail: `Authorization header missing or not Bearer in ${CONFIG_PATH}` };
    }
    return { ok: true, detail: CONFIG_PATH };
  },
};
```

- [ ] **Step 2: Create `scripts/install-mcp/clients/claude-code.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { client } from "./claude-code";

const TMP = path.join(os.tmpdir(), "todox-claude-test");

let savedHome: string | undefined;
let savedPlatform: NodeJS.Platform;

beforeEach(async () => {
  savedHome = process.env.HOME;
  savedPlatform = process.platform;
  await fs.mkdir(TMP, { recursive: true });
  process.env.HOME = TMP;
  Object.defineProperty(process, "platform", { value: "linux" });
  vi.spyOn(process, "platform", "get").mockReturnValue("linux" as NodeJS.Platform);
  // Force JSON fallback: pretend `claude` is not on PATH.
  vi.mock("node:child_process", () => ({
    spawn: () => ({
      on(_e: string, cb: (code: number) => void) {
        cb(1);
        return this;
      },
    }),
  }));
});

afterEach(async () => {
  process.env.HOME = savedHome;
  Object.defineProperty(process, "platform", { value: savedPlatform });
  await fs.rm(TMP, { recursive: true, force: true });
});

describe("claude-code installer (JSON path)", () => {
  it("writes ~/.claude.json with mcpServers.todox", async () => {
    const result = await client.install({
      transport: "http",
      url: "https://www.todox.dev/api/mcp",
      token: "todox_test",
    });
    expect(result.status).toBe("created");
    expect(result.path).toBe(path.join(TMP, ".claude.json"));

    const verify = await client.verify();
    expect(verify.ok).toBe(true);
  });

  it("replaces an existing entry rather than duplicating", async () => {
    await client.install({ transport: "http", url: "https://old/mcp", token: "old" });
    const second = await client.install({
      transport: "http",
      url: "https://new/mcp",
      token: "new",
    });
    expect(second.status).toBe("updated");

    const raw = await fs.readFile(path.join(TMP, ".claude.json"), "utf8");
    expect(JSON.parse(raw).mcpServers.todox.url).toBe("https://new/mcp");
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `pnpm test -- scripts/install-mcp/clients/claude-code.test.ts`
Expected: 2/2 green.

- [ ] **Step 4: Commit**

Branch: `feat/install-mcp-claude-code`.

```bash
git checkout -b feat/install-mcp-claude-code
git add scripts/install-mcp/clients/claude-code.ts scripts/install-mcp/clients/claude-code.test.ts
git commit -m "feat(install-mcp): claude-code installer (native + JSON fallback)"
```

---

## Task 4: Codex installer (`scripts/install-mcp/clients/codex.ts`)

**Files:**
- Create: `scripts/install-mcp/clients/codex.ts`
- Create: `scripts/install-mcp/clients/codex.test.ts`

- [ ] **Step 1: Create `scripts/install-mcp/clients/codex.ts`**

```ts
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { upsertTomlServerSection } from "./toml";
import type { ClientInstaller } from "./types";

const CONFIG_PATH = path.join(os.homedir(), ".codex", "config.toml");
const NAME = "todox";

async function read(p: string): Promise<string> {
  try {
    return await fs.readFile(p, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
}

export const client: ClientInstaller = {
  name: "codex",
  async detect() {
    try {
      await fs.access(CONFIG_PATH);
      return true;
    } catch {
      return false;
    }
  },
  async install({ transport, url, token }) {
    if (transport !== "http") {
      throw new Error("codex currently supports the http transport only");
    }
    const existing = await read(CONFIG_PATH);
    const { text, status } = upsertTomlServerSection(existing, NAME, {
      url,
      headerName: "Authorization",
      headerValue: `Bearer ${token}`,
    });
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    const tmp = `${CONFIG_PATH}.${process.pid}.tmp`;
    await fs.writeFile(tmp, text, "utf8");
    await fs.rename(tmp, CONFIG_PATH);
    return { path: CONFIG_PATH, status, entryId: NAME };
  },
  async verify() {
    const text = await read(CONFIG_PATH);
    if (!text.includes(`[mcp_servers.${NAME}]`)) {
      return { ok: false, detail: `no [mcp_servers.${NAME}] in ${CONFIG_PATH}` };
    }
    if (!text.includes("Bearer ")) {
      return { ok: false, detail: `Authorization header missing in ${CONFIG_PATH}` };
    }
    return { ok: true, detail: CONFIG_PATH };
  },
};
```

- [ ] **Step 2: Create `scripts/install-mcp/clients/codex.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { client } from "./codex";

const TMP = path.join(os.tmpdir(), "todox-codex-test");
const CONFIG = path.join(TMP, ".codex", "config.toml");
let savedHome: string | undefined;

beforeEach(async () => {
  savedHome = process.env.HOME;
  process.env.HOME = TMP;
  await fs.mkdir(path.dirname(CONFIG), { recursive: true });
});

afterEach(async () => {
  process.env.HOME = savedHome;
  await fs.rm(TMP, { recursive: true, force: true });
});

describe("codex installer", () => {
  it("creates ~/.codex/config.toml from scratch", async () => {
    const r = await client.install({
      transport: "http",
      url: "https://www.todox.dev/api/mcp",
      token: "tk",
    });
    expect(r.status).toBe("created");
    expect((await client.verify()).ok).toBe(true);
  });

  it("preserves other sections when updating", async () => {
    await fs.writeFile(
      CONFIG,
      '[other]\nkey = "value"\n\n[mcp_servers.unrelated]\nurl = "https://x/mcp"\n',
      "utf8",
    );
    await client.install({ transport: "http", url: "https://y/mcp", token: "tk2" });
    const text = await fs.readFile(CONFIG, "utf8");
    expect(text).toContain('[other]\nkey = "value"');
    expect(text).toContain("[mcp_servers.unrelated]");
    expect(text).toContain("[mcp_servers.todox]");
    expect(text).toContain("https://y/mcp");
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `pnpm test -- scripts/install-mcp/clients/codex.test.ts`
Expected: 2/2 green.

- [ ] **Step 4: Commit**

Branch: `feat/install-mcp-codex`.

```bash
git checkout -b feat/install-mcp-codex
git add scripts/install-mcp/clients/codex.ts scripts/install-mcp/clients/codex.test.ts
git commit -m "feat(install-mcp): codex installer (TOML append/replace)"
```

---

## Task 5: Cursor + VS Code + OpenCode installers

**Files:**
- Create: `scripts/install-mcp/clients/cursor.ts`
- Create: `scripts/install-mcp/clients/cursor.test.ts`
- Create: `scripts/install-mcp/clients/vscode.ts`
- Create: `scripts/install-mcp/clients/vscode.test.ts`
- Create: `scripts/install-mcp/clients/opencode.ts`
- Create: `scripts/install-mcp/clients/opencode.test.ts`

All three follow the same shape as Task 3 / Task 4 — JSON read/write, replace-by-name, verify. The differences are config paths and root keys.

- [ ] **Step 1: Cursor installer**

`scripts/install-mcp/clients/cursor.ts`:

```ts
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { readJsonFile, writeJsonFile } from "./atomic-write";
import type { ClientInstaller } from "./types";

const CONFIG_PATH = path.join(os.homedir(), ".cursor", "mcp.json");
const NAME = "todox";

export const client: ClientInstaller = {
  name: "cursor",
  async detect() {
    try { await fs.access(CONFIG_PATH); return true; } catch { return false; }
  },
  async install({ transport, url, token }) {
    if (transport !== "http") throw new Error("cursor supports http only");
    const current = (await readJsonFile<Record<string, unknown>>(CONFIG_PATH)) ?? {};
    const servers = (current.mcpServers as Record<string, unknown>) ?? {};
    const existed = NAME in servers;
    servers[NAME] = { url, headers: { Authorization: `Bearer ${token}` } };
    current.mcpServers = servers;
    await writeJsonFile(CONFIG_PATH, current);
    return { path: CONFIG_PATH, status: existed ? "updated" : "created", entryId: NAME };
  },
  async verify() {
    const cfg = await readJsonFile<{ mcpServers?: Record<string, unknown> }>(CONFIG_PATH);
    if (!cfg?.mcpServers?.[NAME]) return { ok: false, detail: `no mcpServers.${NAME} in ${CONFIG_PATH}` };
    return { ok: true, detail: CONFIG_PATH };
  },
};
```

`scripts/install-mcp/clients/cursor.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { client } from "./cursor";

const TMP = path.join(os.tmpdir(), "todox-cursor-test");
const CONFIG = path.join(TMP, ".cursor", "mcp.json");
let savedHome: string | undefined;

beforeEach(async () => { savedHome = process.env.HOME; process.env.HOME = TMP; await fs.mkdir(path.dirname(CONFIG), { recursive: true }); });
afterEach(async () => { process.env.HOME = savedHome; await fs.rm(TMP, { recursive: true, force: true }); });

describe("cursor installer", () => {
  it("writes ~/.cursor/mcp.json", async () => {
    const r = await client.install({ transport: "http", url: "https://x/mcp", token: "tk" });
    expect(r.status).toBe("created");
    expect((await client.verify()).ok).toBe(true);
  });
  it("updates in place", async () => {
    await client.install({ transport: "http", url: "https://a/mcp", token: "t1" });
    const second = await client.install({ transport: "http", url: "https://b/mcp", token: "t2" });
    expect(second.status).toBe("updated");
  });
});
```

- [ ] **Step 2: VS Code installer**

`scripts/install-mcp/clients/vscode.ts`:

```ts
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { readJsonFile, writeJsonFile } from "./atomic-write";
import { vsCodeConfigDir } from "./paths";
import type { ClientInstaller } from "./types";

const NAME = "todox";

export const client: ClientInstaller = {
  name: "vscode",
  async detect() {
    try { await fs.access(path.join(vsCodeConfigDir(), "mcp.json")); return true; } catch { return false; }
  },
  async install({ transport, url, token }) {
    if (transport !== "http") throw new Error("vscode supports http only");
    const cfgPath = path.join(vsCodeConfigDir(), "mcp.json");
    const current = (await readJsonFile<Record<string, unknown>>(cfgPath)) ?? {};
    // VS Code uses root key `servers`, not `mcpServers`. Mixing them up is the
    // single most common install bug for this client.
    const servers = (current.servers as Record<string, unknown>) ?? {};
    const existed = NAME in servers;
    servers[NAME] = { type: "http", url, headers: { Authorization: `Bearer ${token}` } };
    current.servers = servers;
    await writeJsonFile(cfgPath, current);
    return { path: cfgPath, status: existed ? "updated" : "created", entryId: NAME };
  },
  async verify() {
    const cfgPath = path.join(vsCodeConfigDir(), "mcp.json");
    const cfg = await readJsonFile<{ servers?: Record<string, unknown> }>(cfgPath);
    if (!cfg?.servers?.[NAME]) return { ok: false, detail: `no servers.${NAME} in ${cfgPath}` };
    return { ok: true, detail: cfgPath };
  },
};
```

`scripts/install-mcp/clients/vscode.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { client } from "./vscode";

const TMP = path.join(os.tmpdir(), "todox-vscode-test");
let savedHome: string | undefined;
let savedAppData: string | undefined;
let savedPlatform: NodeJS.Platform;

beforeEach(async () => {
  savedHome = process.env.HOME;
  savedAppData = process.env.APPDATA;
  savedPlatform = process.platform;
  process.env.HOME = TMP;
  process.env.APPDATA = path.join(TMP, "AppData", "Roaming");
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  vi.spyOn(process, "platform", "get").mockReturnValue("win32" as NodeJS.Platform);
  await fs.mkdir(path.join(process.env.APPDATA!, "Code", "User"), { recursive: true });
});

afterEach(async () => {
  process.env.HOME = savedHome;
  process.env.APPDATA = savedAppData;
  Object.defineProperty(process, "platform", { value: savedPlatform, configurable: true });
  await fs.rm(TMP, { recursive: true, force: true });
});

describe("vscode installer", () => {
  it("writes APPDATA/Code/User/mcp.json under the root key `servers`", async () => {
    const r = await client.install({ transport: "http", url: "https://x/mcp", token: "tk" });
    expect(r.status).toBe("created");
    const cfg = JSON.parse(await fs.readFile(path.join(process.env.APPDATA!, "Code", "User", "mcp.json"), "utf8"));
    expect(cfg.servers.todox.type).toBe("http");
    expect((await client.verify()).ok).toBe(true);
  });
});
```

- [ ] **Step 3: OpenCode installer**

`scripts/install-mcp/clients/opencode.ts`:

```ts
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { readJsonFile, writeJsonFile } from "./atomic-write";
import type { ClientInstaller } from "./types";

const CONFIG_PATH = path.join(os.homedir(), ".config", "opencode", "opencode.json");
const NAME = "todox";

/**
 * OpenCode runs the MCP server as a local stdio child process by default --
 * the process sits beside the developer's editor and has its filesystem. The
 * HTTP transport works too, but stdio is the path the developer doesn't have
 * to keep alive across machines.
 */
async function stdioCommand(): Promise<{ command: string; args: string[]; env: Record<string, string> }> {
  // `pnpm dlx todox-mcp-stdio` would be the published entry. For this monorepo
  // we point at the local source so the install command also works on a
  // developer's checkout of the repo without a publish step.
  return {
    command: "npx",
    args: ["-y", "tsx", path.resolve(process.cwd(), "mcp/server.ts")],
    env: { TODOX_URL: "https://www.todox.dev", TODOX_TOKEN: "${TODOX_TOKEN}" },
  };
}

export const client: ClientInstaller = {
  name: "opencode",
  async detect() {
    try { await fs.access(CONFIG_PATH); return true; } catch { return false; }
  },
  async install({ transport, token }) {
    const current = (await readJsonFile<Record<string, unknown>>(CONFIG_PATH)) ?? { mcp: {} };
    const mcp = (current.mcp as Record<string, unknown>) ?? {};
    const existed = NAME in mcp;
    if (transport === "stdio") {
      const stdio = await stdioCommand();
      mcp[NAME] = {
        type: "local",
        command: stdio.command,
        args: stdio.args,
        env: { TODOX_TOKEN: stdio.env.TODOX_TOKEN },
      };
    } else {
      mcp[NAME] = {
        type: "remote",
        url: "https://www.todox.dev/api/mcp",
        headers: { Authorization: `Bearer ${token}` },
      };
    }
    current.mcp = mcp;
    await writeJsonFile(CONFIG_PATH, current);
    return { path: CONFIG_PATH, status: existed ? "updated" : "created", entryId: NAME };
  },
  async verify() {
    const cfg = await readJsonFile<{ mcp?: Record<string, unknown> }>(CONFIG_PATH);
    if (!cfg?.mcp?.[NAME]) return { ok: false, detail: `no mcp.${NAME} in ${CONFIG_PATH}` };
    return { ok: true, detail: CONFIG_PATH };
  },
};
```

`scripts/install-mcp/clients/opencode.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { client } from "./opencode";

const TMP = path.join(os.tmpdir(), "todox-opencode-test");
const CONFIG = path.join(TMP, ".config", "opencode", "opencode.json");
let savedHome: string | undefined;

beforeEach(async () => { savedHome = process.env.HOME; process.env.HOME = TMP; await fs.mkdir(path.dirname(CONFIG), { recursive: true }); });
afterEach(async () => { process.env.HOME = savedHome; await fs.rm(TMP, { recursive: true, force: true }); });

describe("opencode installer", () => {
  it("defaults to stdio transport (local child)", async () => {
    const r = await client.install({ transport: "stdio", token: "tk" });
    expect(r.status).toBe("created");
    const cfg = JSON.parse(await fs.readFile(CONFIG, "utf8"));
    expect(cfg.mcp.todox.type).toBe("local");
    expect(cfg.mcp.todox.command).toBe("npx");
    expect((await client.verify()).ok).toBe(true);
  });
  it("honours http transport when requested", async () => {
    await client.install({ transport: "http", token: "tk" });
    const cfg = JSON.parse(await fs.readFile(CONFIG, "utf8"));
    expect(cfg.mcp.todox.type).toBe("remote");
    expect(cfg.mcp.todox.url).toContain("/api/mcp");
  });
});
```

- [ ] **Step 4: Run all five installer tests**

Run: `pnpm test -- scripts/install-mcp/clients`
Expected: 9 installer tests green (claude-code 2, codex 2, cursor 2, vscode 1, opencode 2). The paths/atomic-write/toml helper tests from Task 2 add another 12.

- [ ] **Step 5: Commit**

Branch: `feat/install-mcp-cursor-vscode-opencode`.

```bash
git checkout -b feat/install-mcp-cursor-vscode-opencode
git add scripts/install-mcp/clients/cursor.ts scripts/install-mcp/clients/cursor.test.ts scripts/install-mcp/clients/vscode.ts scripts/install-mcp/clients/vscode.test.ts scripts/install-mcp/clients/opencode.ts scripts/install-mcp/clients/opencode.test.ts
git commit -m "feat(install-mcp): cursor, vscode, opencode installers"
```

---

## Task 6: `scripts/install-mcp/index.ts` — argv, dispatch, verify

**Files:**
- Create: `scripts/install-mcp/index.ts`
- Create: `scripts/install-mcp/index.test.ts`
- Modify: `package.json` (add scripts)

**Interfaces:**
- Consumes: `client` from each of the five installer modules
- Produces: a runnable CLI

- [ ] **Step 1: Create `scripts/install-mcp/parse.ts`**

The argument parser has to be testable without booting the whole CLI. Lift it into its own file before anything else — it has no dependencies on the installers or on `process.argv`.

```ts
#!/usr/bin/env -S npx tsx
/**
 * Argument parser for the install-mcp CLI. Pure function so it is trivially
 * testable; `index.ts` is the only caller and binds the parsed args to the
 * registered installers.
 */
export type ParsedArgs = {
  client: string;
  url: string;
  token: string;
  transport: "http" | "stdio";
  dryRun: boolean;
  verbose: boolean;
};

const KNOWN_CLIENTS = ["claude-code", "codex", "cursor", "vscode", "opencode"] as const;

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  const clientName = positional[0];
  if (!clientName || !(KNOWN_CLIENTS as readonly string[]).includes(clientName)) {
    throw new Error(
      `client must be one of: ${KNOWN_CLIENTS.join(", ")} (got '${clientName ?? ""}')`,
    );
  }
  const transport = (flags.transport as string | undefined) ?? "http";
  if (transport !== "http" && transport !== "stdio") {
    throw new Error(`--transport must be 'http' or 'stdio' (got '${transport}')`);
  }
  return {
    client: clientName,
    url: (flags.url as string | undefined) ?? "https://www.todox.dev/api/mcp",
    token: (flags.token as string | undefined) ?? process.env.TODOX_TOKEN ?? "",
    transport,
    dryRun: Boolean(flags["dry-run"]),
    verbose: Boolean(flags.verbose),
  };
}
```

- [ ] **Step 2: Create `scripts/install-mcp/parse.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parseArgs } from "./parse";

describe("parseArgs", () => {
  it("throws on unknown client", () => {
    expect(() => parseArgs(["wat"])).toThrow(/client must be one of/);
  });

  it("accepts a known client and defaults", () => {
    expect(parseArgs(["claude-code"])).toEqual({
      client: "claude-code",
      url: "https://www.todox.dev/api/mcp",
      token: "",
      transport: "http",
      dryRun: false,
      verbose: false,
    });
  });

  it("parses flags and short-forms", () => {
    expect(
      parseArgs([
        "codex",
        "--transport",
        "stdio",
        "--token",
        "tk",
        "--url",
        "https://x/mcp",
        "--dry-run",
        "--verbose",
      ]),
    ).toEqual({
      client: "codex",
      url: "https://x/mcp",
      token: "tk",
      transport: "stdio",
      dryRun: true,
      verbose: true,
    });
  });

  it("rejects an invalid transport", () => {
    expect(() => parseArgs(["cursor", "--transport", "ftp"])).toThrow(/--transport/);
  });

  it("treats --dry-run and --verbose as boolean flags without a value", () => {
    expect(parseArgs(["opencode", "--dry-run"]).dryRun).toBe(true);
    expect(parseArgs(["opencode", "--verbose"]).verbose).toBe(true);
  });

  it("reads TODOX_TOKEN from the environment when --token is absent", () => {
    const saved = process.env.TODOX_TOKEN;
    process.env.TODOX_TOKEN = "from-env";
    try {
      expect(parseArgs(["vscode"]).token).toBe("from-env");
    } finally {
      process.env.TODOX_TOKEN = saved;
    }
  });
});
```

- [ ] **Step 3: Create `scripts/install-mcp/index.ts`**

```ts
#!/usr/bin/env -S npx tsx
/**
 * todox MCP install CLI.
 *
 * Usage:
 *   pnpm install:mcp <client> [--url URL] [--token TOKEN] [--transport http|stdio] [--dry-run] [--verbose]
 *
 * Where <client> is one of: claude-code, codex, cursor, vscode, opencode.
 *
 * The default URL is the production host. Token falls back to $TODOX_TOKEN,
 * otherwise the script prompts (TTY only, with input muted so the secret does
 * not land in the scrollback). --dry-run prints the plan and exits without
 * writing. The doctor pass at the end is what makes a silent failure loud.
 */
import { client as claudeCode } from "./clients/claude-code";
import { client as codex } from "./clients/codex";
import { client as cursor } from "./clients/cursor";
import { client as opencode } from "./clients/opencode";
import { client as vscode } from "./clients/vscode";
import { runDoctor } from "./doctor";
import { parseArgs } from "./parse";

const CLIENTS = {
  "claude-code": claudeCode,
  codex,
  cursor,
  vscode,
  opencode,
} as const;

function mask(token: string): string {
  if (token.length < 8) return "***";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/**
 * Read a token from the user without echoing it to the terminal. `readline`
 * echoes by default, so we drop into raw mode and accumulate bytes ourselves.
 * Throws when stdin is not a TTY (CI without TODOX_TOKEN is a configuration
 * error, not a prompt opportunity).
 */
async function promptForToken(): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "no --token given and TODOX_TOKEN is unset; pass --token <value> or set TODOX_TOKEN",
    );
  }
  process.stdout.write("todox token: ");
  return new Promise<string>((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 0x0d || byte === 0x0a) {
          finish();
          return;
        }
        if (byte === 0x03) {
          process.stdin.removeListener("data", onData);
          process.stdin.setRawMode?.(false);
          reject(new Error("interrupted"));
          return;
        }
        if (byte === 0x08 || byte === 0x7f) {
          buf = buf.slice(0, -1);
        } else {
          buf += String.fromCharCode(byte);
        }
      }
      process.stdout.write("*");
    };
    const finish = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode?.(false);
      process.stdout.write("\n");
      resolve(buf.trim());
    };
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.token) args.token = await promptForToken();
  if (!args.token) throw new Error("a token is required");

  const installer = CLIENTS[args.client as keyof typeof CLIENTS];

  console.error(`[todox] target : ${args.client}`);
  console.error(`[todox] url    : ${args.url}`);
  console.error(`[todox] token  : ${mask(args.token)}`);
  console.error(`[todox] transport: ${args.transport}`);

  const detected = await installer.detect();
  console.error(`[todox] detect : ${detected ? "found" : "no existing config (will create)"}`);

  if (args.dryRun) {
    console.error("[todox] dry-run; nothing written");
    return;
  }

  const result = await installer.install({
    transport: args.transport,
    url: args.url,
    token: args.token,
  });
  console.error(`[todox] wrote  : ${result.path} (${result.status})`);

  const verify = await installer.verify();
  if (!verify.ok) {
    console.error(`[todox] verify : FAIL — ${verify.detail}`);
    process.exit(1);
  }
  console.error(`[todox] verify : ok (${verify.detail})`);

  // Only run the doctor on http transports. Stdio spawns a child process
  // that we cannot reach from this CLI without a known MCP client.
  if (args.transport === "http") {
    const report = await runDoctor({ url: args.url, token: args.token });
    console.error(`[todox] doctor : ${report.ok ? "ok" : "FAIL"}`);
    if (args.verbose) console.error(report.detail);
    if (!report.ok) process.exit(1);
  }
}

main().catch((e) => {
  console.error("[todox]", e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [ ] **Step 4: Create `scripts/install-mcp/doctor.ts`**

```ts
/**
 * Standalone MCP doctor — initialize + tools/list + a get_context call
 * against a known repo. Used by the install CLI as a post-install smoke,
 * and runnable on its own for "is this server reachable from my machine?"
 * debugging. The get_context call exercises the full request/response cycle
 * (auth, schema, repository resolution) so a broken deploy fails here rather
 * than at the agent's first session.
 */
export type DoctorReport = { ok: boolean; detail: string };

const PROTOCOL = "2025-06-18";

async function rpc(
  url: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...body }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

export async function runDoctor(opts: {
  url: string;
  token: string;
  cwd?: string;
}): Promise<DoctorReport> {
  const cwd = opts.cwd ?? process.cwd();

  // 1. initialize
  const init = await rpc(opts.url, opts.token, {
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: "todox-install-doctor", version: "0" },
    },
  });
  if (init.status !== 200) {
    return { ok: false, detail: `initialize HTTP ${init.status}` };
  }

  // 2. tools/list
  const tools = await rpc(opts.url, opts.token, {
    id: 2,
    method: "tools/list",
  });
  if (tools.status !== 200) {
    return { ok: false, detail: `tools/list HTTP ${tools.status}` };
  }
  const names = (((tools.json as { result?: { tools?: Array<{ name: string }> } })?.result?.tools) ?? [])
    .map((t) => t.name);
  const required = ["get_context", "create_task", "log_entry"];
  const missing = required.filter((r) => !names.includes(r));
  if (missing.length) {
    return { ok: false, detail: `tools missing: ${missing.join(", ")}` };
  }

  // 3. get_context against the cwd. Exercises auth + schema + project lookup.
  const ctx = await rpc(opts.url, opts.token, {
    id: 3,
    method: "tools/call",
    params: { name: "get_context", arguments: { cwd, create_if_missing: false } },
  });
  if (ctx.status !== 200) {
    return { ok: false, detail: `get_context HTTP ${ctx.status}` };
  }
  const ctxBody = ctx.json as {
    result?: { content?: Array<{ type: string; text?: string }> };
    error?: { message?: string };
  };
  if (ctxBody.error) {
    return { ok: false, detail: `get_context error: ${ctxBody.error.message ?? "unknown"}` };
  }
  const text = ctxBody.result?.content?.[0]?.text ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, detail: "get_context returned non-JSON" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, detail: "get_context returned no body" };
  }

  return {
    ok: true,
    detail: `protocol=${PROTOCOL} tools=${names.length} briefing-ok`,
  };
}
```

- [ ] **Step 5: Run the parse tests**

Run: `pnpm test -- scripts/install-mcp/parse.test.ts`
Expected: 6/6 green.

- [ ] **Step 6: Add `install:mcp` and `mcp:doctor` scripts to `package.json`**

Edit `package.json`:

```json
"scripts": {
  ...
  "install:mcp": "tsx scripts/install-mcp/index.ts",
  "mcp:doctor": "tsx scripts/install-mcp/doctor.ts"
}
```

- [ ] **Step 7: Smoke the CLI manually (against the production server)**

Run:
```bash
pnpm install:mcp --dry-run claude-code --token "$TODOX_TOKEN"
```
Expected output:
```
[todox] target : claude-code
[todox] url    : https://www.todox.dev/api/mcp
[todox] token  : <masked>
[todox] transport: http
[todox] detect : found|not found
[todox] dry-run; nothing written
```
Exit code 0.

Then drop `--dry-run` and run it for real on a throwaway user (the user they tested with). Expected: install writes `~/.claude.json` (or updates it), verify returns ok, doctor returns ok. Exit 0.

- [ ] **Step 8: Run lint, typecheck, full test suite**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test`
Expected: clean.

- [ ] **Step 9: Commit**

Branch: `feat/install-mcp-cli-doctor`.

```bash
git checkout -b feat/install-mcp-cli-doctor
git add scripts/install-mcp/parse.ts scripts/install-mcp/parse.test.ts scripts/install-mcp/index.ts scripts/install-mcp/doctor.ts package.json
git commit -m "feat(install-mcp): CLI entry, silent token prompt, doctor with get_context"
```

---

## Task 7: Capture client info on every MCP session (DB-backed)

**Files:**
- Modify: `lib/db/schema.ts` (add three columns to `api_tokens`)
- Modify: `lib/repositories/api-tokens.ts` (add `recordClientUse`, `lastClientUse`)
- Create: `lib/services/rpc-schemas.ts` (add `recordClientInfo` method shape — already gets `model` via Task 1)
- Modify: `lib/services/rpc.ts` (add `recordClientInfo` handler)
- Create: `lib/server/client-info.ts` (DB-backed `record/lookup/normalise/clientFamily`)
- Create: `lib/server/client-info.test.ts`
- Modify: `app/api/mcp/route.ts` (capture `initialize` clientInfo, call `recordClientInfo` after auth)
- Modify: `mcp/server.ts` (read `TODOX_CLIENT_NAME` at startup, call `recordClientInfo` once)
- Modify: `mcp/tools.ts` (`Workspace` gets `bearerToken`, `get_context` transform uses it)

**Why:** The HTTP transport is `sessionIdGenerator: undefined` (stateless), and Vercel cold starts reset any per-instance `Map`. The only state that survives across instances is the database. Three columns on `api_tokens` (rather than a new table) keep the lookup keyed on the existing unique `token_hash` and avoid an extra repository.

**Stdio capture strategy:** The MCP SDK's `initialize` message is handled inside the SDK before any tool callback runs, so wrapping the tool callback (the earlier draft) never fires. Instead, the stdio server reads `TODOX_CLIENT_NAME` and `TODOX_CLIENT_VERSION` from its environment at startup. The OpenCode installer writes those env vars into the opencode.json it produces; the other clients do not (their MCP configs do not allow arbitrary child env), and on those the HTTP `initialize` capture is the only path.

- [ ] **Step 1: Add columns to `api_tokens` in `lib/db/schema.ts`**

Find the existing block:
```sql
CREATE TABLE IF NOT EXISTS api_tokens (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);
```
Append immediately after the existing `ALTER TABLE` statements (around line 240):
```sql
-- Last MCP client to use this token. Surfaces in get_context so the agent
-- hears client-specific advice (e.g. "create ~/.claude/CLAUDE.md" on Claude
-- Code). Last-write-wins; one token shared across a laptop and CI will see
-- the most recent user's client. That is acceptable -- the wrong note is
-- louder than the right note, and the user can read the mismatch.
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS last_client_name     TEXT;
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS last_client_version  TEXT;
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS last_client_seen_at  TEXT;
```

- [ ] **Step 2: Add repo methods to `lib/repositories/api-tokens.ts`**

Read the file first to mirror its existing style. Append (do not rewrite existing exports):

```ts
import { exec, query } from "../db/client";

/** SHA-256 of the literal token. Same hash the auth path already uses. */
function hashToken(token: string): string {
  // Use the same crypto import the rest of the file uses; this stub is here
  // to keep the snippet self-contained -- the implementer replaces it with
  // the project's own helper.
  return token; // REPLACE: actual sha256 hex
}

export type ClientUse = { name: string; version: string; seenAt: string };

export async function recordClientUse(
  tokenHash: string,
  use: ClientUse,
): Promise<void> {
  await exec(
    `UPDATE api_tokens
        SET last_client_name = $1, last_client_version = $2, last_client_seen_at = $3
      WHERE token_hash = $4`,
    [use.name, use.version, use.seenAt, tokenHash],
  );
}

export async function lastClientUse(tokenHash: string): Promise<ClientUse | null> {
  const rows = await query<{ name: string; version: string; seenAt: string }>(
    `SELECT last_client_name AS name,
            last_client_version AS version,
            last_client_seen_at AS "seenAt"
       FROM api_tokens
      WHERE token_hash = $1
        AND last_client_seen_at IS NOT NULL`,
    [tokenHash],
  );
  return rows[0] ?? null;
}
```

- [ ] **Step 3: Add the RPC method shape**

In `lib/services/rpc-schemas.ts`, append inside `SHAPES`:

```ts
  recordClientInfo: {
    name: z.string().min(1).max(MAX.line).describe("Client name from MCP initialize"),
    version: z.string().max(MAX.line).optional().describe("Client version; defaults to 'unknown'"),
    model,
  },
```

Verify `parseParams` is wired through `Object.entries(SHAPES).map(...)` or wherever the validator index is built (line 314 area). If a manual list of method names exists, add `recordClientInfo` to it.

- [ ] **Step 4: Add the handler in `lib/services/rpc.ts`**

Read `rpc.ts` to find the `methods` object. Append:

```ts
  async recordClientInfo(ctx, p) {
    const { token } = ctx;
    if (!token) throw new BadRequest("missing token");
    const tokenHash = hashToken(token); // existing helper -- see auth.ts
    await apiTokens.recordClientUse(tokenHash, {
      name: p.name,
      version: p.version ?? "unknown",
      seenAt: new Date().toISOString(),
    });
    return { ok: true };
  },
```

This requires `RpcContext` to carry `token: string | undefined`. Add it if it is not already present; check by reading `lib/services/rpc.ts` lines 280-330. Also confirm the existing `hashToken` helper name (it might be `hash` or similar) and import accordingly.

- [ ] **Step 5: Create `lib/server/client-info.ts`**

```ts
/**
 * DB-backed record of the last MCP client to use a given token. Three columns
 * on `api_tokens` -- last_client_name, last_client_version,
 * last_client_seen_at -- keyed on the existing unique token_hash.
 *
 * Serverless-safe: a Vercel cold start resets any in-memory Map, but Postgres
 * is shared by every instance. The trade-off is a round-trip per request on
 * the `get_context` path; acceptable because that is also the path that needs
 * the data.
 */

import { lastClientUse, recordClientUse } from "../repositories/api-tokens";
import { hashToken } from "./auth";

export type ClientInfo = {
  name: string;
  version: string;
  capturedAt: number;
};

const TTL_MS = 60 * 60 * 1000; // one hour; longer than any realistic session

/** Coerce an unknown clientInfo payload into a usable record, or null. */
export function normalise(raw: { name?: unknown; version?: unknown }): ClientInfo | null {
  if (typeof raw.name !== "string" || raw.name.length === 0) return null;
  return {
    name: raw.name,
    version: typeof raw.version === "string" ? raw.version : "unknown",
    capturedAt: Date.now(),
  };
}

export async function record(token: string, info: ClientInfo): Promise<void> {
  await recordClientUse(hashToken(token), {
    name: info.name,
    version: info.version,
    seenAt: new Date(info.capturedAt).toISOString(),
  });
}

export async function lookup(token: string): Promise<ClientInfo | null> {
  const use = await lastClientUse(hashToken(token));
  if (!use) return null;
  const seenAt = Date.parse(use.seenAt);
  if (!Number.isFinite(seenAt)) return null;
  if (Date.now() - seenAt > TTL_MS) return null;
  return { name: use.name, version: use.version, capturedAt: seenAt };
}

export type ClientFamily =
  | "claude-code"
  | "codex"
  | "cursor"
  | "vscode"
  | "opencode"
  | "unknown";

/**
 * Map a captured client name onto a client family. Loose on purpose -- a new
 * Claude Code build that announces itself as "claude-code-experimental" still
 * routes to the same advice.
 */
export function clientFamily(name: string): ClientFamily {
  const n = name.toLowerCase();
  if (n.includes("claude")) return "claude-code";
  if (n.includes("codex")) return "codex";
  if (n.includes("cursor")) return "cursor";
  if (n.includes("vscode") || n.includes("copilot")) return "vscode";
  if (n.includes("opencode")) return "opencode";
  return "unknown";
}
```

- [ ] **Step 6: Create `lib/server/client-info.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { clientFamily, normalise } from "./client-info";

vi.mock("../repositories/api-tokens", () => ({
  recordClientUse: vi.fn().mockResolvedValue(undefined),
  lastClientUse: vi.fn().mockResolvedValue(null),
}));

afterEach(() => vi.clearAllMocks());

describe("normalise", () => {
  it("returns null for missing name", () => {
    expect(normalise({})).toBeNull();
    expect(normalise({ name: "", version: "1" })).toBeNull();
  });
  it("returns null for non-string name", () => {
    expect(normalise({ name: 42 })).toBeNull();
  });
  it("captures name and version", () => {
    expect(normalise({ name: "claude-code", version: "1.2.3" })).toEqual({
      name: "claude-code",
      version: "1.2.3",
      capturedAt: expect.any(Number),
    });
  });
});

describe("clientFamily", () => {
  it.each([
    ["claude-code", "claude-code"],
    ["Claude Code", "claude-code"],
    ["codex-cli", "codex"],
    ["codex_experimental", "codex"],
    ["Cursor", "cursor"],
    ["vscode", "vscode"],
    ["GitHub Copilot Chat", "vscode"],
    ["opencode", "opencode"],
    ["random-thing", "unknown"],
  ] as const)("%s -> %s", (input, expected) => {
    expect(clientFamily(input)).toBe(expected);
  });
});

/**
 * Integration with the repository is exercised end-to-end by
 * `scripts/mcp-smoke.ts` against a live server, not in this unit. The unit
 * tests here cover the pure helpers so a regression in the DB path fails in
 * CI before the slower smoke runs.
 */
```

- [ ] **Step 7: Wire HTTP route**

In `app/api/mcp/route.ts`:

1. Add the import near the top:
   ```ts
   import { clientFamily, lookup, normalise, record } from "@/lib/server/client-info";
   ```
2. After `body = await req.json();` succeeds (line ~87), add:
   ```ts
   captureClientInfo(token, body);
   ```
3. Add the helper function before `registerTools(...)`:
   ```ts
   async function captureClientInfo(token: string, body: unknown): Promise<void> {
     if (!body || typeof body !== "object") return;
     const method = (body as { method?: unknown }).method;
     if (method !== "initialize") return;
     const params = (body as { params?: unknown }).params;
     if (!params || typeof params !== "object") return;
     const info = normalise(
       (params as { clientInfo?: { name?: unknown; version?: unknown } }).clientInfo ?? {},
     );
     if (!info) return;
     try {
       await record(token, info);
     } catch (e) {
       // Recording clientInfo must not break the request. Log and move on.
       console.error("mcp clientInfo", e);
     }
   }
   ```

- [ ] **Step 8: Wire stdio server**

In `mcp/server.ts`, inside `main()` after `const call = createClient(url, token);` (line ~41), add:

```ts
  // The MCP SDK consumes `initialize` before any tool callback runs, so we
  // cannot capture clientInfo from there. Instead, the parent process sets
  // TODOX_CLIENT_NAME / TODOX_CLIENT_VERSION when it launches us, and we
  // record once on startup.
  const clientName = process.env.TODOX_CLIENT_NAME;
  if (clientName) {
    try {
      await call("recordClientInfo", {
        name: clientName,
        version: process.env.TODOX_CLIENT_VERSION ?? "unknown",
      });
    } catch (e) {
      console.error("mcp clientInfo", e instanceof Error ? e.message : e);
    }
  }
```

The OpenCode installer (Task 5) writes `TODOX_CLIENT_NAME: "opencode"` into the opencode.json it produces. The other clients' HTTP transports rely on the initialize capture from Step 7.

- [ ] **Step 9: Update `Workspace` and the `get_context` transform in `mcp/tools.ts`**

In `mcp/tools.ts`:

1. Extend the `Workspace` type (line 27-36):
   ```ts
   export type Workspace = {
     tz(): string | undefined;
     repoRoot(path: string): string | undefined;
     hash(path: string): string | null;
     checkRefs(refs: RefLike[]): { checked: Checked[]; seen: { id: number; hash: string | null }[] } | null;
     /** Bearer token of the request that triggered this tool call. */
     bearerToken(): string | undefined;
   };
   ```
2. In `app/api/mcp/route.ts`'s `remoteWorkspace`, add:
   ```ts
   bearerToken: () => token,
   ```
3. In `mcp/server.ts`'s `localWorkspace`, add:
   ```ts
   bearerToken: () => token, // `token` is the destructured `readConfig()` result
   ```
4. Add the helper near the top of `mcp/tools.ts` (just below `const fail`):
   ```ts
   import { clientFamily, lookup } from "../lib/server/client-info";
   import { notesFor } from "./client-notes";

   async function appendClientNotes(
     ws: Workspace,
     result: unknown,
   ): Promise<unknown> {
     if (!result || typeof result !== "object") return result;
     const token = ws.bearerToken();
     if (!token) return result;
     const info = await lookup(token);
     if (!info) return result;
     const family = clientFamily(info.name);
     return {
       ...(result as Record<string, unknown>),
       client: info.name,
       notes: notesFor(family),
     };
   }
   ```
5. Replace the `get_context` tool registration (around line 462) with:
   ```ts
     tool(
       "get_context",
       "getContext",
       {
         title: "Get project context (call this first)",
         description:
           "Read what previous sessions on this project already worked out, so you do not ask the developer to explain it again or repeat a mistake somebody already made. The session-start briefing: standing rules, decisions and why the alternatives lost, approaches that were tried and failed, open questions, in-flight tasks with their linked files, and the note the last session left behind. Also flags notes whose files have changed since they were written. Call this before planning any non-trivial work; pass your working directory as `cwd`.",
         annotations: READ_ONLY,
       },
       {
         after: checkLinkedFiles,
         transform: async (result, _args) => appendClientNotes(ws, result),
       },
     );
   ```

- [ ] **Step 10: Run the migration against the live DB**

Run:
```bash
pnpm db:migrate
```
Expected: applied without error. Verify with:
```bash
psql "$DATABASE_URL" -c "\d api_tokens"
```
Expected: the three new columns visible.

- [ ] **Step 11: Run lint, typecheck, tests**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test`
Expected: clean.

- [ ] **Step 12: Commit**

Branch: `feat/mcp-client-info-db`.

```bash
git checkout -b feat/mcp-client-info-db
git add lib/db/schema.ts lib/repositories/api-tokens.ts lib/services/rpc-schemas.ts lib/services/rpc.ts lib/server/client-info.ts lib/server/client-info.test.ts app/api/mcp/route.ts mcp/server.ts mcp/tools.ts
git commit -m "feat(mcp): DB-backed clientInfo capture and notes injection"
```

---

## Task 8: Client-specific notes builder + `docs/mcp.md`

**Files:**
- Create: `mcp/client-notes.ts`
- Create: `docs/mcp.md`
- Modify: `mcp/tools.ts` (link to `docs/mcp.md` from `BASE`; the `appendClientNotes` helper itself lives in Task 7 because it depends on `Workspace.bearerToken`)

**Interfaces:**
- Consumes: nothing
- Produces: a `notesFor(family)` helper used by Task 7's transform, and a doc that points clients at the install instructions

- [ ] **Step 1: Create `mcp/client-notes.ts`**

```ts
import type { ClientFamily } from "../lib/server/client-info";

/**
 * Notes appended to a get_context response, keyed by the client family the
 * developer's machine is running. Each note is short -- the agent's context
 * is precious and most of these only matter once per session.
 *
 * Claude Code is the one with a real gap today: it does not auto-load
 * ~/.codex/AGENTS.md, so it never hears the four-line contract. Telling it
 * here is the closed loop.
 */
const NOTES: Record<ClientFamily, string[]> = {
  "claude-code": [
    "You are on Claude Code. The MCP is connected, but the four-line contract " +
      "(call get_context first; pass model on every method; leave a handoff) " +
      "lives in ~/.claude/CLAUDE.md, which Claude Code auto-loads but is NOT " +
      "created by todox. Create it once:",
    "  echo '...see docs/mcp.md...' > ~/.claude/CLAUDE.md",
    "Without that file, the contract degrades to a hint -- still useful, but " +
      "not enforced across sessions.",
  ],
  codex: [
    "You are on Codex. ~/.codex/AGENTS.md is auto-loaded as the user-scope " +
      "instruction file; todox did not need to create it. The contract is in " +
      "force.",
  ],
  cursor: [
    "You are on Cursor. Cursor does not auto-load a global rules file. The " +
      "contract degrades to a hint. To enforce it for one project, create " +
      "./.cursorrules at the project root with the four lines from " +
      "docs/mcp.md.",
  ],
  vscode: [
    "You are on VS Code (GitHub Copilot). The MCP is connected, but VS Code " +
      "does not auto-load global rules for Copilot Chat. To enforce per-repo, " +
      "create .github/copilot-instructions.md at the repo root with the four " +
      "lines from docs/mcp.md.",
  ],
  opencode: [
    "You are on OpenCode. ~/.config/opencode/AGENTS.md is auto-loaded as the " +
      "user-scope instruction file. The contract is in force.",
  ],
  unknown: [
    "todox does not recognise your MCP client name. The contract still " +
      "applies: call get_context first; pass model on every method; leave a " +
      "handoff before stopping. See docs/mcp.md for the full text.",
  ],
};

export function notesFor(family: ClientFamily): string[] {
  return NOTES[family];
}
```

- [ ] **Step 2: Create `docs/mcp.md`**

```markdown
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
```

- [ ] **Step 3: Update `mcp/tools.ts` `BASE` instructions to point at the doc**

Replace the `ALWAYS pass model` block (lines 93-95, updated again in Task 1 Step 6) with a paragraph that cites the doc path:

```ts
  "ALWAYS pass `model` with your own model id on every method — write tools",
  "record it on the row, read tools use it as telemetry. The full client-side",
  "contract lives in docs/mcp.md; `pnpm install:mcp <client>` can paste it.",
```

- [ ] **Step 4: Run lint, typecheck, tests**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test`
Expected: clean.

- [ ] **Step 5: Smoke against the production server**

Run the doctor pass:
```bash
TODOX_TOKEN=<redacted> pnpm mcp:doctor
```
Expected: `[todox] doctor : ok` with `briefing-ok` in the detail. Then re-run `pnpm install:mcp claude-code` against the production server with a fresh throwaway user and confirm `get_context` returns a `notes` array with at least the Claude Code paragraph.

- [ ] **Step 6: Commit**

Branch: `feat/mcp-client-notes-and-docs`.

```bash
git checkout -b feat/mcp-client-notes-and-docs
git add mcp/client-notes.ts docs/mcp.md mcp/tools.ts
git commit -m "feat(mcp): client-notes builder and docs/mcp.md"
```

---

## Task 9: End-to-end verification

- [ ] **Step 1: Full pipeline**

Run, in order:
```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
```
Expected: all four green. The build is the one that catches a missing `tsconfig` include or a dead `import`.

- [ ] **Step 2: Install against every supported client**

For each of `claude-code`, `codex`, `cursor`, `vscode`, `opencode`, run:
```bash
pnpm install:mcp <client> --token "$TODOX_TOKEN" --verbose
```
Expected: each ends with `[todox] verify : ok` and `[todox] doctor : ok`. Inspect the written config file and confirm:
- the entry key is `todox`
- the URL is `https://www.todox.dev/api/mcp`
- the Authorization header is `Bearer <masked>`
- no duplicate entries

- [ ] **Step 3: `get_context` from each client returns `notes`**

From each client, invoke `get_context` with a known `cwd`. Confirm the response includes:
- `client: "<client-name>"`
- `notes: [...]` with at least the family-specific paragraph

For Claude Code, the paragraph should mention `~/.claude/CLAUDE.md`. For VS Code / Cursor, it should mention the per-project rule file.

- [ ] **Step 4: PR + merge**

Open one PR titled `feat(mcp): install CLI, client-aware notes`. List the eight implementation tasks as commit references, in this order:

1. `feat/schema-model-on-all-methods` (Task 1)
2. `feat/install-mcp-types-paths-atomic-write-toml` (Task 2)
3. `feat/install-mcp-claude-code` (Task 3)
4. `feat/install-mcp-codex` (Task 4)
5. `feat/install-mcp-cursor-vscode-opencode` (Task 5)
6. `feat/install-mcp-cli-doctor` (Task 6)
7. `feat/mcp-client-info-db` (Task 7)
8. `feat/mcp-client-notes-and-docs` (Task 8)

Each branch is rebased onto the previous one before pushing; the PR merges them into a single linear history. Merge after CI green.

- [ ] **Step 5: `log_entry` the work into todox**

```bash
TODOX_TOKEN=<redacted> bash -c '
curl -sS -X POST https://www.todox.dev/api/rpc \
  -H "Authorization: Bearer $TODOX_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"method\":\"createTask\",\"params\":{\"cwd\":\"C:\\\\Users\\\\Furkan Beydemir\\\\todox\",\"title\":\"MCP install friction (schema + install-mcp + client notes)\",\"body\":\"Shipped.\",\"status\":\"done\",\"priority\":2,\"model\":\"minimax/MiniMax-M3\"}}"
'
```
Then 4× `logEntry`:
1. handoff: schema (`model` accepted everywhere; instructions updated)
2. handoff: install-mcp CLI (5 clients, doctor, package.json scripts)
3. handoff: client-info capture + notes injection (`docs/mcp.md` is the contract source)
4. dead_end: HTTP `process.env.TODOX_TOKEN` not available in the request-scoped transform — follow-up if notes ever come back empty on HTTP

## Known limitations

1. **Per-instance Vercel cold starts lose any in-memory cache.** Solved by moving client-info to `api_tokens` columns (Task 7). Any future per-session state in the MCP server MUST go through the DB; an in-memory `Map` will silently break in serverless.

2. **Stdio client capture depends on env vars the parent sets.** Clients whose MCP config does not let the user pass child env (Claude Code, Cursor, VS Code, Codex HTTP) capture from the JSON-RPC `initialize` body instead — which only works on the HTTP transport. A pure-stdio install of those clients will not get `notes`. Acceptable: the production install target is HTTP for those four.

3. **`get_context` already runs `checkLinkedFiles` via `after`.** The new `transform` runs after `after`, so file staleness is settled before notes are appended — correct ordering, but worth a re-read if the chain ever gets reordered.

4. **Token in `~/.claude.json` (and equivalent) is plaintext.** Acceptable for a personal tool whose threat model is "no one else logs into my laptop". A future task is to read the token from a keyring via `@napi-rs/keyring` on Windows / `secret-tool` on Linux — but it changes the install UX (interactive prompt every time) and is out of scope here.

5. **`installViaNativeCli` passes the token in argv.** On Linux/macOS, `ps aux` shows the full command line, so the bearer token briefly lives in the process table. Acceptable for a single user on a single laptop; not acceptable on a shared host. Noted for the security review when this code is shared with a wider audience.

## Out of scope (future plans)

These were on the original list but are deliberately deferred:

- (3) `mcp-doctor` as a standalone CLI — implemented as `pnpm mcp:doctor` already; broader UX (table output, retry) is its own plan.
- (4) `/docs/mcp` install page on the website — Next.js page that renders `docs/mcp.md` plus per-client tabs. New page, new i18n keys, separate concern.
- (6) `.well-known/mcp-config.json` — publish the install config in a standard location so clients that support auto-discovery pick it up. New file, no schema change.
- (7) Tool annotations: `readOnlyHint: true` is already set on read tools (line 177 of `mcp/tools.ts`). `destructiveHint: false` on writes is the next step but needs the SDK version on Vercel to support the field, which it currently does not — deferred until we upgrade.

Each is one PR. None is a prerequisite for this one.

---

## Self-Review

**1. Spec coverage:**
- `model` accepted on every method → Task 1 (behaviour-level test using `parseParams`)
- `install-mcp` CLI for 5 clients → Tasks 3, 4, 5
- CLI argv + dispatch + verify + doctor → Task 6
- Per-token DB-backed client-info capture + HTTP `initialize` + stdio env → Task 7
- `notes` field in `get_context` response + `docs/mcp.md` → Task 8 (transform lives in Task 7 because it depends on `Workspace.bearerToken`)
- Manual end-to-end verification + PR + `log_entry` → Task 9
- Out-of-scope items explicitly listed above ✓

**2. Placeholder scan:**
- No "TBD", no "TODO", no "implement later" - every step has concrete code or commands.
- No "add appropriate error handling" - error handling is specified where it matters (Task 6's `promptForToken` raw-mode echo suppression, Task 7's `captureClientInfo` try/catch).
- No "similar to Task N" - every client installer is fully written.
- Task 6 Step 3's earlier "replace with this version if preferred" hedge was replaced with a single committed path (lift `parseArgs` into `parse.ts`).
- No file structure claim without an implementation: the "lock file" line was removed in favour of "single-write atomic rename" once the scope was honest about it.

**3. Type consistency:**
- `ClientInstaller` is defined in Task 2 and consumed in Tasks 3, 4, 5 - name and shape are stable.
- `ParsedArgs` is defined in `parse.ts` (Task 6 Step 1) and consumed by `index.ts` and `parse.test.ts` - single source of truth.
- `ClientFamily` is defined in Task 7 (`lib/server/client-info.ts`) and consumed by Task 8 (`mcp/client-notes.ts`) and Task 7's own `appendClientNotes` - name is stable.
- `Workspace.bearerToken` is added in Task 7 Step 9 and consumed by `appendClientNotes` - both transports (`localWorkspace` in `mcp/server.ts`, `remoteWorkspace` in `app/api/mcp/route.ts`) implement it.
- `notes` field is described in Task 8 and verified in Task 9 Step 3 - consistent.

**4. Repo-rule fit (post-review pass):**
- One-table-per-repository: `recordClientUse` / `lastClientUse` live on `lib/repositories/api-tokens.ts` and only touch `api_tokens`. ✓
- No cross-table logic in repositories: `recordClientInfo` handler in `rpc.ts` makes one repo call. ✓
- Schemas declare every RPC method: `recordClientInfo` is added in Task 7 Step 3 with a Zod shape. ✓
- "Never build a SET clause by hand": the new UPDATE uses bound parameters; no column names interpolated from caller input. ✓
- Server never touches the filesystem: HTTP `recordClientInfo` uses the DB; stdio startup `recordClientInfo` goes via the HTTP `call` helper, not the filesystem. ✓
- Tool surface defined once: `install-mcp` writes config files, never re-implements the MCP tool layer. ✓
- No `any`, no `as` shortcuts in the public surface (Task 7's `appendClientNotes` uses `unknown` + type guard). ✓

**5. Known limitations acknowledged in the plan:**
- Per-instance Vercel cold starts reset in-memory caches — solved by moving client-info to the DB (Task 7). ✓
- Stdio client capture depends on parent-set env vars — documented in Task 7 Step 8 and the `Known limitations` section. ✓
- Plaintext token in config files — out of scope, deferred. ✓
- `installViaNativeCli` token in argv — visible in `ps` — documented as `Known limitations` #5. ✓

No drift detected.