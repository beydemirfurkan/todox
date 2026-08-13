import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MCP_SHAPES } from "@/lib/mcp-clients";

import { AgentSetup, snippetsFor, type AgentSetupLabels } from "./agent-setup";

/**
 * These snippets are the install path for everyone who does not clone the
 * repository, which is most people — they paste what this component renders
 * and never see the CLI. It had no test, and it showed: there was no OpenCode
 * entry at all, so an OpenCode user took the generic one, which is `mcpServers`
 * with `type: "http"`. OpenCode reads that file, does not find a server where
 * it looks, and says nothing.
 */

const LABELS: AgentSetupLabels = {
  promptTitle: "Paste this to your agent",
  promptWarning: "Contains your token",
  manualTitle: "Or edit the config yourself",
  agentLabel: "Agent",
  other: "Other",
  scopeNote: "Install globally",
  verify: "Verify with get_context",
  copy: "Copy",
  copied: "Copied",
};

const URL = "https://www.todox.dev/api/mcp";
const TOKEN = "todox_test_token";

/**
 * The component renders one snippet at a time behind a client-side picker, and
 * these tests run without a DOM. `snippetsFor` is exported for exactly that:
 * the bodies are the thing under test, not the pill that reveals them.
 */
const bodyOf = (id: string) => {
  const found = snippetsFor(URL, TOKEN, LABELS.other).find((s) => s.id === id);
  if (!found) throw new Error(`no snippet with id '${id}'`);
  return found;
};

describe("agent snippets", () => {
  it("offers every client todox documents", () => {
    const ids = snippetsFor(URL, TOKEN, LABELS.other).map((s) => s.id);
    // OpenCode is the one that was missing while both the README and the
    // install CLI supported it.
    expect(ids).toContain("opencode");
    expect(ids).toEqual(
      expect.arrayContaining(["claude", "codex", "cursor", "vscode", "opencode", "other"]),
    );
  });

  it("gives OpenCode `remote` under mcp.servers, never `http` under mcpServers", () => {
    const parsed = JSON.parse(bodyOf("opencode").body);

    expect(parsed.mcp.servers.todox.type).toBe("remote");
    expect(parsed.mcp.servers.todox.url).toBe(URL);
    expect(parsed.mcpServers).toBeUndefined();
  });

  it("offers the OpenCode v1 layout separately, one level shallower", () => {
    const parsed = JSON.parse(bodyOf("opencode-v1").body);

    expect(parsed.mcp.todox.type).toBe("remote");
    expect(parsed.mcp.servers).toBeUndefined();
  });

  it("gives VS Code `servers`, not `mcpServers`", () => {
    const parsed = JSON.parse(bodyOf("vscode").body);

    expect(parsed.servers.todox.type).toBe("http");
    expect(parsed.mcpServers).toBeUndefined();
  });

  it("gives Cursor `mcpServers` with the type spelled out", () => {
    const parsed = JSON.parse(bodyOf("cursor").body);

    // A client that finds a url without a type tends to assume a local command
    // and fail with something unhelpful.
    expect(parsed.mcpServers.todox.type).toBe("http");
  });

  it("matches the shapes the installer writes", () => {
    // Same knowledge, two consumers. This is the assertion that keeps the
    // pasted snippet and the CLI's output from drifting apart.
    const cases = [
      { id: "cursor", shape: MCP_SHAPES.cursor },
      { id: "vscode", shape: MCP_SHAPES.vscode },
      { id: "opencode", shape: MCP_SHAPES["opencode-v2"] },
      { id: "opencode-v1", shape: MCP_SHAPES["opencode-v1"] },
    ] as const;

    for (const { id, shape } of cases) {
      let node = JSON.parse(bodyOf(id).body);
      for (const key of shape.rootKeys) {
        expect(node, `${id}: missing '${key}'`).toHaveProperty(key);
        node = node[key];
      }
      expect(node.todox.type, id).toBe(shape.remoteType);
    }
  });

  it("puts every snippet's token in a Bearer header", () => {
    for (const snippet of snippetsFor(URL, TOKEN, LABELS.other)) {
      expect(snippet.body, snippet.id).toContain(`Bearer ${TOKEN}`);
    }
  });

  it("produces JSON that parses, for every JSON client", () => {
    // A trailing comma or an unquoted key would be pasted straight into a
    // config file and rejected there instead of here.
    for (const snippet of snippetsFor(URL, TOKEN, LABELS.other)) {
      if (snippet.id === "claude" || snippet.id === "codex") continue;
      expect(() => JSON.parse(snippet.body), snippet.id).not.toThrow();
    }
  });

  it("names a config location for every client that is not a terminal command", () => {
    for (const snippet of snippetsFor(URL, TOKEN, LABELS.other)) {
      expect(snippet.target, snippet.id).toBeTruthy();
    }
  });

  it("spells out all three paths for VS Code, and only for VS Code", () => {
    for (const snippet of snippetsFor(URL, TOKEN, LABELS.other)) {
      if (snippet.id === "vscode") {
        // macOS is not the Linux path, and that is the whole reason this list
        // exists rather than one line.
        expect(snippet.paths?.darwin).toBe("~/Library/Application Support/Code/User/mcp.json");
        expect(snippet.paths?.linux).toBe("~/.config/Code/User/mcp.json");
        expect(snippet.paths?.win32).toContain("%APPDATA%");
      } else {
        // Everyone else has one path; a second list would just be noise.
        expect(snippet.paths, snippet.id).toBeUndefined();
      }
    }
  });
});

describe("AgentSetup", () => {
  it("renders the prompt and the picker without leaking the token into a url", () => {
    const html = renderToStaticMarkup(
      <AgentSetup url={URL} token={TOKEN} prompt="todox MCP is installed here." labels={LABELS} />,
    );

    expect(html).toContain("todox MCP is installed here.");
    expect(html).toContain("OpenCode");
    expect(html).toContain("VS Code");
    // The picker opens on Claude Code, so the VS Code path list is not in the
    // first paint -- but its pill has to be, or nothing reveals it.
    expect(html).toContain("Claude Code");
    // The token belongs in a header; in a url it would reach logs and referrers.
    expect(html).not.toContain(`${URL}/${TOKEN}`);
    expect(html).not.toContain(`?token=${TOKEN}`);
  });
});
