"use client";

import { useState } from "react";

import {
  MCP_CONFIG_PATHS,
  MCP_SHAPES,
  mcpEntryDocument,
  type McpConfigLocation,
} from "@/lib/mcp-clients";

import { CopyMarkdown } from "./copy-markdown";

/**
 * What you get once a token exists.
 *
 * The paste-to-your-agent block leads, because it is the only option that does
 * not require knowing which config file your tool keeps and where. The
 * per-agent snippets are underneath for people who would rather edit the file
 * themselves.
 *
 * Everything is derived in the browser from the token the action returned. The
 * server does not compose these: it cannot see which machine, which tool or
 * which directory is on the other end, and the last version that pretended
 * otherwise shipped a command with the server's own working directory in it.
 */
export type AgentSetupLabels = {
  promptTitle: string;
  promptWarning: string;
  manualTitle: string;
  agentLabel: string;
  other: string;
  scopeNote: string;
  verify: string;
  copy: string;
  copied: string;
};

/**
 * Only the shapes differ; every one of them is url + bearer header.
 *
 * Every target here is the *global* one, and that is the whole point. Each of
 * these tools defaults to a per-project location -- `claude mcp add` without a
 * scope writes to the current directory, `.cursor/mcp.json` and
 * `.vscode/mcp.json` live in a checkout -- so following the obvious
 * instructions gave you a memory that worked in exactly one folder. For a tool
 * whose reason to exist is knowing what happened in your other projects, that
 * is the wrong default in the most expensive possible way: it looks like it
 * worked.
 */
/** A whole config file, formatted the way it is pasted. */
function json(shape: (typeof MCP_SHAPES)[keyof typeof MCP_SHAPES], url: string, token: string) {
  return JSON.stringify(mcpEntryDocument(shape, url, token), null, 2);
}

export type AgentSnippet = {
  id: string;
  name: string;
  /** Where this goes, in one line. */
  target: string;
  /** Set only when the file moves between platforms, which is VS Code alone. */
  paths?: McpConfigLocation;
  /** The text that is pasted, complete rather than a fragment. */
  body: string;
};

export function snippetsFor(
  url: string,
  token: string,
  otherLabel: string,
): AgentSnippet[] {
  const bearer = `Bearer ${token}`;
  return [
    {
      id: "claude",
      name: "Claude Code",
      target: "terminal",
      // `--scope user`, not the default `local`, which means this directory.
      body: `claude mcp add --scope user --transport http todox ${url} \\\n  --header "Authorization: ${bearer}"`,
    },
    {
      id: "codex",
      name: "Codex",
      target: MCP_CONFIG_PATHS.codex.darwin,
      body: [
        "[mcp_servers.todox]",
        `url = "${url}"`,
        `http_headers = { Authorization = "${bearer}" }`,
      ].join("\n"),
    },
    {
      id: "cursor",
      name: "Cursor",
      // The one in your home directory, not the `.cursor/mcp.json` inside a
      // repository.
      target: MCP_CONFIG_PATHS.cursor.darwin,
      body: json(MCP_SHAPES.cursor, url, token),
    },
    {
      id: "vscode",
      name: "VS Code",
      // The command palette leads because it is the one instruction that is
      // right on every platform. The paths are underneath for anyone opening
      // the file directly -- this is the only client whose config moves, and
      // macOS is not where a Linux habit puts it.
      target: "mcp.json — “MCP: Open User Configuration”",
      paths: MCP_CONFIG_PATHS.vscode,
      body: json(MCP_SHAPES.vscode, url, token),
    },
    {
      // OpenCode was missing here entirely while the README documented it and
      // the install CLI supported it, so an OpenCode user fell through to the
      // generic entry below — `mcpServers` with `type: "http"`, which OpenCode
      // accepts into the file and then ignores. No error, no warning, the tool
      // just never appears.
      id: "opencode",
      name: "OpenCode",
      target: MCP_CONFIG_PATHS.opencode.darwin,
      body: json(MCP_SHAPES["opencode-v2"], url, token),
    },
    {
      // v1 keyed servers directly under `mcp`. Its own entry rather than a note
      // under the one above: the two differ by a nesting level, and a reader
      // comparing a snippet against their existing file cannot be expected to
      // spot that from prose.
      id: "opencode-v1",
      name: "OpenCode v1",
      target: MCP_CONFIG_PATHS.opencode.darwin,
      body: json(MCP_SHAPES["opencode-v1"], url, token),
    },
    {
      id: "other",
      name: otherLabel,
      target: "your client's user-level mcp.json",
      // The shape most clients settled on. `type` is spelled out because a
      // client that finds a url without one tends to assume a local command.
      body: json(MCP_SHAPES["claude-code"], url, token),
    },
  ];
}

const pre =
  "mono overflow-x-auto rounded-[8px] border-[1.5px] border-line bg-paper p-2.5 text-[12px] break-all whitespace-pre-wrap";

export function AgentSetup({
  url,
  token,
  prompt,
  labels,
}: {
  url: string;
  token: string;
  /** Rendered on the server, where the translator lives. */
  prompt: string;
  labels: AgentSetupLabels;
}) {
  const all = snippetsFor(url, token, labels.other);
  const [chosen, setChosen] = useState(all[0].id);
  const current = all.find((s) => s.id === chosen);

  return (
    <div className="space-y-4">
      <div>
        <p className="display mb-2 text-[14px] font-bold">{labels.promptTitle}</p>
        <pre className={pre}>{prompt}</pre>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <CopyMarkdown markdown={prompt} label={labels.copy} copiedLabel={labels.copied} />
          <p className="text-[12.5px] text-faint">{labels.promptWarning}</p>
        </div>
      </div>

      <div className="border-t border-dashed border-rule pt-3">
        <p className="display mb-1 text-[14px] font-bold">{labels.manualTitle}</p>
        <p className="mb-2 text-[12.5px] text-muted">{labels.scopeNote}</p>

        <div role="group" aria-label={labels.agentLabel} className="flex flex-wrap gap-1.5">
          {all.map((s) => {
            const active = s.id === chosen;
            return (
              <button
                key={s.id}
                type="button"
                // Not disabled when active: a control that says which one you
                // are on has to stay reachable, and on a touch screen a dead
                // button is indistinguishable from a missed tap.
                aria-pressed={active}
                onClick={() => setChosen(s.id)}
                // `.seg` reads the selection off `aria-pressed`, so there is no
                // second copy of it to keep in step.
                className="pill seg"
              >
                {s.name}
              </button>
            );
          })}
        </div>

        {current && (
          <div className="mt-2.5">
            <p className="mono mb-1 text-[11.5px] text-faint">{current.target}</p>
            {current.paths && (
              // Labelled per platform rather than guessed from the browser: the
              // machine reading this page is not always the machine the config
              // is for, and a wrong path here is the failure that looks like a
              // successful install.
              // `break-all` because these are paths: the longest is 46
              // characters of unbroken text, which is wider than a 320px
              // viewport at this size and would scroll the page sideways.
              <ul className="mono mb-1 space-y-0.5 text-[11.5px] break-all text-faint">
                {(
                  [
                    ["macOS", current.paths.darwin],
                    ["Linux", current.paths.linux],
                    ["Windows", current.paths.win32],
                  ] as const
                ).map(([platform, file]) => (
                  <li key={platform}>
                    <span className="text-muted">{platform}</span> {file}
                  </li>
                ))}
              </ul>
            )}
            <pre className={pre}>{current.body}</pre>
            <div className="mt-2">
              <CopyMarkdown
                markdown={current.body}
                label={labels.copy}
                copiedLabel={labels.copied}
              />
            </div>
          </div>
        )}
      </div>

      <p className="text-[13px] text-muted">{labels.verify}</p>
    </div>
  );
}
