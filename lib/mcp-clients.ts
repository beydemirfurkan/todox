/**
 * What each MCP client expects in its config, written down once.
 *
 * Three places needed this and each kept its own copy: the install CLI, the
 * README, and the snippets the Account page hands a user after it mints a
 * token. They drifted, in the way that costs the most — the README's per-agent
 * table gave VS Code the wrong root key, and the Account page had no OpenCode
 * entry at all, so an OpenCode user fell through to a `mcpServers` snippet that
 * their client accepts into the file and then ignores. No error, no warning,
 * the tool simply never appears.
 *
 * Deliberately free of `node:` imports: the Account page is a client component,
 * so anything it shares with the installer has to survive in a browser bundle.
 * Absolute paths are therefore not resolved here — `scripts/install-mcp/clients/
 * contract.ts` does that on top of these locations, and a test holds the two
 * to each other.
 */

/** Clients todox documents a config shape for. */
export type McpClientId = "claude-code" | "codex" | "cursor" | "vscode" | "opencode";

/**
 * The JSON shape a client reads.
 *
 * Neither field is interchangeable between clients, and getting either wrong
 * fails silently, which is why they travel together rather than being spelled
 * out at each call site.
 */
export type McpJsonShape = {
  /** Keys from the document root down to the map of server entries. */
  readonly rootKeys: readonly string[];
  /** `type` value on a remote server entry. */
  readonly remoteType: "http" | "remote";
};

/**
 * Keyed by wire shape rather than by client, because OpenCode has two: v1 keys
 * servers directly under `mcp`, v2 nests them under `mcp.servers`. Same file,
 * same client, and no way to tell them apart from a config that is empty.
 */
export const MCP_SHAPES = {
  "claude-code": { rootKeys: ["mcpServers"], remoteType: "http" },
  cursor: { rootKeys: ["mcpServers"], remoteType: "http" },
  vscode: { rootKeys: ["servers"], remoteType: "http" },
  "opencode-v1": { rootKeys: ["mcp"], remoteType: "remote" },
  "opencode-v2": { rootKeys: ["mcp", "servers"], remoteType: "remote" },
} as const satisfies Record<string, McpJsonShape>;

export type McpShapeId = keyof typeof MCP_SHAPES;

/**
 * Where a client keeps that config, written the way a human reads it.
 *
 * Per platform because one of them differs: VS Code is an Electron app and
 * follows Apple's convention on macOS, so the XDG-style path that is right on
 * Linux is wrong on a Mac — and wrong invisibly, since `~/.config/Code/User`
 * does not exist there and writing to it simply creates it.
 */
export type McpConfigLocation = {
  readonly darwin: string;
  readonly linux: string;
  readonly win32: string;
};

/** The same path on every platform, which is the common case. */
function everywhere(path: string): McpConfigLocation {
  return { darwin: path, linux: path, win32: path };
}

export const MCP_CONFIG_PATHS = {
  "claude-code": everywhere("~/.claude.json"),
  cursor: everywhere("~/.cursor/mcp.json"),
  codex: everywhere("~/.codex/config.toml"),
  opencode: everywhere("~/.config/opencode/opencode.json"),
  vscode: {
    darwin: "~/Library/Application Support/Code/User/mcp.json",
    linux: "~/.config/Code/User/mcp.json",
    win32: "%APPDATA%\\Code\\User\\mcp.json",
  },
} as const satisfies Record<McpClientId, McpConfigLocation>;

/**
 * The habit, written once.
 *
 * Connecting a server and having it used are different things: an MCP server's
 * `instructions` are background reading, and lose to a rule in the file the
 * agent actually obeys. Measured, in a fresh project, with todox connected the
 * whole time and never once called. These lines are the fix, and they are
 * pasted by a reader of the README, offered by the Account page, and written by
 * the installer -- three surfaces, which is exactly how the config shapes above
 * ended up disagreeing before this module existed.
 *
 * The token deliberately does not appear. It belongs in the MCP config; this is
 * the habit, not the credential, and memory files get committed to repositories.
 */
export const MEMORY_SNIPPET = `todox MCP is installed here — persistent memory across projects.

- Call \`get_context\` before starting non-trivial work (cwd = your working
  directory). It registers a new repo by itself.
- \`create_task\` for anything that will not finish this session.
- Before stopping, \`log_entry(kind:'handoff')\` on every task you touched,
  and \`dead_end\` for approaches that failed.
- Always pass your own model id.`;

/**
 * Where a client reads instructions that apply to *every* project.
 *
 * User-level, never the project file, and the distinction is the whole point.
 * `.cursorrules`, `.github/copilot-instructions.md` and a repo's `AGENTS.md`
 * are all read only inside the checkout that holds them, so a habit written
 * there is absent in the next repository -- the same failure the MCP config
 * has when it lands in `local` scope, where the tools simply are not there and
 * nothing errors. A memory that is meant to cross projects cannot be installed
 * per project.
 *
 * `kind` is not decoration: Cursor and VS Code read a *directory* of
 * instruction files rather than one file, so todox writes its own file inside
 * rather than appending to somebody else's.
 *
 * Every entry is a claim about someone else's software, checked against that
 * software's own documentation on 2026-08-16 rather than remembered:
 *   claude-code  code.claude.com/docs — ~/.claude/CLAUDE.md
 *   codex        developers.openai.com/codex/cli — ~/.codex/AGENTS.md
 *   cursor       cursor.com/docs/rules — user rules in ~/.cursor/rules;
 *                `.cursorrules` is legacy and on its way out
 *   vscode       code.visualstudio.com/docs/agent-customization —
 *                ~/.copilot/instructions, searched recursively
 *   opencode     opencode.ai/docs/rules — ~/.config/opencode/AGENTS.md
 */
export type McpMemoryTarget = {
  readonly location: McpConfigLocation;
  /** Whether `location` names the file itself or a directory to write into. */
  readonly kind: "file" | "directory";
};

/** What todox calls its own file, where the client reads a directory. */
export const MEMORY_FILE_NAME = "todox.md";

export const MCP_MEMORY_PATHS = {
  "claude-code": { location: everywhere("~/.claude/CLAUDE.md"), kind: "file" },
  codex: { location: everywhere("~/.codex/AGENTS.md"), kind: "file" },
  cursor: { location: everywhere("~/.cursor/rules"), kind: "directory" },
  vscode: { location: everywhere("~/.copilot/instructions"), kind: "directory" },
  opencode: { location: everywhere("~/.config/opencode/AGENTS.md"), kind: "file" },
} as const satisfies Record<McpClientId, McpMemoryTarget>;

/**
 * The entry todox writes, for a client that takes JSON over HTTP.
 *
 * Returned rather than stringified so callers can nest it wherever their shape
 * puts it; `mcpEntryDocument` does the nesting.
 */
export function mcpEntry(
  shape: McpJsonShape,
  url: string,
  token: string,
): Record<string, unknown> {
  return {
    type: shape.remoteType,
    url,
    headers: { Authorization: `Bearer ${token}` },
  };
}

/**
 * A whole config document containing just the todox entry, nested at the shape's
 * key path. This is what a user pastes, so it has to be the complete file a
 * client would accept, not a fragment.
 */
export function mcpEntryDocument(
  shape: McpJsonShape,
  url: string,
  token: string,
  name = "todox",
): Record<string, unknown> {
  let node: Record<string, unknown> = { [name]: mcpEntry(shape, url, token) };
  for (const key of [...shape.rootKeys].reverse()) {
    node = { [key]: node };
  }
  return node;
}
