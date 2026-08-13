import { describe, expect, it } from "vitest";

import {
  MCP_CONFIG_PATHS,
  MCP_SHAPES,
  mcpEntry,
  mcpEntryDocument,
  type McpJsonShape,
} from "./mcp-clients";

/**
 * These are claims about someone else's software, and every one of them fails
 * silently when it is wrong — a client reads the file, does not find a server
 * where it looks, and says nothing. So the values are asserted literally here
 * rather than derived, and the derivation happens in the consumers.
 */
describe("MCP_SHAPES", () => {
  it("gives VS Code `servers`, not `mcpServers`", () => {
    // The single most common install bug for this client. The README's own
    // per-agent table had it backwards while the installer had it right.
    expect(MCP_SHAPES.vscode.rootKeys).toEqual(["servers"]);
  });

  it("gives Claude Code and Cursor `mcpServers` with type http", () => {
    expect(MCP_SHAPES["claude-code"]).toEqual({ rootKeys: ["mcpServers"], remoteType: "http" });
    expect(MCP_SHAPES.cursor).toEqual({ rootKeys: ["mcpServers"], remoteType: "http" });
  });

  it("gives OpenCode `remote`, and nests v2 one level deeper than v1", () => {
    // `http` is accepted into an OpenCode config and then ignored.
    expect(MCP_SHAPES["opencode-v1"]).toEqual({ rootKeys: ["mcp"], remoteType: "remote" });
    expect(MCP_SHAPES["opencode-v2"]).toEqual({
      rootKeys: ["mcp", "servers"],
      remoteType: "remote",
    });
  });

  it("never leaves a shape without a root key", () => {
    for (const [id, shape] of Object.entries(MCP_SHAPES)) {
      expect(shape.rootKeys.length, id).toBeGreaterThan(0);
    }
  });
});

describe("MCP_CONFIG_PATHS", () => {
  it("puts VS Code under Application Support on darwin and XDG on linux", () => {
    expect(MCP_CONFIG_PATHS.vscode.darwin).toBe(
      "~/Library/Application Support/Code/User/mcp.json",
    );
    expect(MCP_CONFIG_PATHS.vscode.linux).toBe("~/.config/Code/User/mcp.json");
    expect(MCP_CONFIG_PATHS.vscode.win32).toBe("%APPDATA%\\Code\\User\\mcp.json");
  });

  it("keeps every other client on one path across platforms", () => {
    // VS Code is the only one that moves. If a second ever does, this fails and
    // the UI stops being able to show a single path for it.
    for (const [id, location] of Object.entries(MCP_CONFIG_PATHS)) {
      if (id === "vscode") continue;
      expect(new Set(Object.values(location)).size, id).toBe(1);
    }
  });
});

describe("mcpEntryDocument", () => {
  const shape = (rootKeys: string[], remoteType: "http" | "remote"): McpJsonShape => ({
    rootKeys,
    remoteType,
  });

  it("produces a whole file, not a fragment", () => {
    // What the Account page shows is pasted as-is, so it has to be something a
    // client would accept on its own.
    expect(mcpEntryDocument(shape(["mcpServers"], "http"), "https://x/api/mcp", "tk")).toEqual({
      mcpServers: {
        todox: {
          type: "http",
          url: "https://x/api/mcp",
          headers: { Authorization: "Bearer tk" },
        },
      },
    });
  });

  it("nests through a multi-key path in order", () => {
    expect(mcpEntryDocument(shape(["mcp", "servers"], "remote"), "https://x", "tk")).toEqual({
      mcp: {
        servers: {
          todox: { type: "remote", url: "https://x", headers: { Authorization: "Bearer tk" } },
        },
      },
    });
  });

  it("puts the token in the header and nowhere else", () => {
    const doc = JSON.stringify(mcpEntryDocument(MCP_SHAPES.vscode, "https://x", "todox_secret"));
    expect(doc).toContain('"Authorization":"Bearer todox_secret"');
    // A url with the token pasted into it would leak the credential into logs
    // and referrers on every request.
    expect(doc).not.toContain("https://x/todox_secret");
  });

  it("names the entry todox by default and honours an override", () => {
    expect(Object.keys(mcpEntry(MCP_SHAPES.cursor, "https://x", "tk"))).toEqual([
      "type",
      "url",
      "headers",
    ]);
    const renamed = mcpEntryDocument(MCP_SHAPES.cursor, "https://x", "tk", "todox-dev");
    expect(Object.keys(renamed.mcpServers as object)).toEqual(["todox-dev"]);
  });
});
