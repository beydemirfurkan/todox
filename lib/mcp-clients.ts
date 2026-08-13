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
