"use client";

import { useState } from "react";

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
  verify: string;
  copy: string;
  copied: string;
};

/** Only the shapes differ; every one of them is url + bearer header. */
function snippets(url: string, token: string, otherLabel: string) {
  const bearer = `Bearer ${token}`;
  return [
    {
      id: "claude",
      name: "Claude Code",
      target: "terminal",
      body: `claude mcp add --transport http todox ${url} \\\n  --header "Authorization: ${bearer}"`,
    },
    {
      id: "codex",
      name: "Codex",
      target: "~/.codex/config.toml",
      body: [
        "[mcp_servers.todox]",
        `url = "${url}"`,
        `http_headers = { Authorization = "${bearer}" }`,
      ].join("\n"),
    },
    {
      id: "cursor",
      name: "Cursor",
      target: ".cursor/mcp.json",
      body: JSON.stringify(
        { mcpServers: { todox: { type: "http", url, headers: { Authorization: bearer } } } },
        null,
        2,
      ),
    },
    {
      id: "vscode",
      name: "VS Code",
      // Different root key from everyone else, which is the sort of thing that
      // costs an evening if the snippet is copied from the wrong tool.
      target: ".vscode/mcp.json",
      body: JSON.stringify(
        { servers: { todox: { type: "http", url, headers: { Authorization: bearer } } } },
        null,
        2,
      ),
    },
    {
      id: "other",
      name: otherLabel,
      target: "mcp.json",
      // The shape most clients settled on. `type` is spelled out because a
      // client that finds a url without one tends to assume a local command.
      body: JSON.stringify(
        { mcpServers: { todox: { type: "http", url, headers: { Authorization: bearer } } } },
        null,
        2,
      ),
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
  const all = snippets(url, token, labels.other);
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
        <p className="display mb-2 text-[14px] font-bold">{labels.manualTitle}</p>

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
                className="pill !text-[12.5px]"
                style={
                  active
                    ? { background: "var(--accent)", color: "var(--on-fill)" }
                    : { background: "var(--inset)", color: "var(--muted)" }
                }
              >
                {s.name}
              </button>
            );
          })}
        </div>

        {current && (
          <div className="mt-2.5">
            <p className="mono mb-1 text-[11.5px] text-faint">{current.target}</p>
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
