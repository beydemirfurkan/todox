/**
 * todox MCP install CLI.
 *
 * Usage:
 *   pnpm install:mcp <client> [--url URL] [--token TOKEN] [--transport http|stdio]
 *                             [--opencode-layout v1|v2] [--dry-run] [--verbose]
 *
 * Where <client> is one of: claude-code, codex, cursor, vscode, opencode.
 *
 * The default URL is the production host. Token falls back to $TODOX_TOKEN,
 * otherwise the script prompts (TTY only, with input muted so the secret does
 * not land in the scrollback). --dry-run prints the plan and exits without
 * writing. The doctor pass at the end is what makes a silent failure loud.
 */
import * as os from "node:os";

import { client as claudeCode } from "./clients/claude-code";
import { client as codex } from "./clients/codex";
import { client as cursor } from "./clients/cursor";
import { client as opencode } from "./clients/opencode";
import { client as vscode } from "./clients/vscode";
import { runDoctor } from "./doctor";
import { parseArgs } from "./parse";
import { maskToken, promptForToken } from "./prompt";

const CLIENTS = {
  "claude-code": claudeCode,
  codex,
  cursor,
  vscode,
  opencode,
} as const;

/**
 * Print todox entries found where the client does not read them. Warned about
 * rather than deleted: the file belongs to the user, and a CLI that silently
 * edits config it was not asked to touch is the same class of surprise this
 * output exists to end.
 */
function reportStale(stale: readonly string[]): void {
  if (stale.length === 0) return;
  console.error(
    `[todox] stale  : ${stale.length} todox entr${stale.length === 1 ? "y" : "ies"} ` +
      "in a location this client does not read:",
  );
  for (const entry of stale) console.error(`[todox]          - ${entry}`);
  console.error("[todox]          remove them by hand; they are not what the client loads.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.token) args.token = await promptForToken();
  if (!args.token) throw new Error("a token is required");

  const installer = CLIENTS[args.client as keyof typeof CLIENTS];

  console.error(`[todox] target : ${args.client}`);
  console.error(`[todox] url    : ${args.url}`);
  console.error(`[todox] token  : ${maskToken(args.token)}`);
  console.error(`[todox] transport: ${args.transport}`);
  // The facts you ask for when a config landed somewhere the client is not
  // reading — which is the failure this CLI is most likely to be run over.
  if (args.verbose) {
    console.error(
      `[todox] host   : ${process.platform} · node ${process.versions.node} · home ${os.homedir()}`,
    );
  }

  const detected = await installer.detect();
  console.error(`[todox] detect : ${detected ? "found" : "no existing config (will create)"}`);

  // Before the write, so `--dry-run` is enough to find out that an existing
  // install has been sitting somewhere the client never reads.
  reportStale(await installer.staleInstalls());

  if (args.dryRun) {
    console.error("[todox] dry-run; nothing written");
    return;
  }

  const result = await installer.install({
    transport: args.transport,
    url: args.url,
    token: args.token,
    openCodeLayout: args.openCodeLayout,
  });
  console.error(`[todox] wrote  : ${result.path} (${result.status})`);
  if (result.note) console.error(`[todox] layout : ${result.note}`);

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
    // The detail is the whole value of a failure — "FAIL" on its own leaves
    // the user with a config that was written and no idea what to do next, so
    // it is printed whether or not --verbose was asked for.
    console.error(`[todox] doctor : ${report.ok ? "ok" : "FAIL"} — ${report.detail}`);
    if (!report.ok) {
      console.error(
        "[todox]          the config above was written; fix the cause and re-run.",
      );
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error("[todox]", e instanceof Error ? e.message : e);
  process.exit(1);
});
