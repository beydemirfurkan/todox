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
    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode?.(false);
    };
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 0x0d || byte === 0x0a) {
          cleanup();
          process.stdout.write("\n");
          resolve(buf.trim());
          return;
        }
        if (byte === 0x03) {
          cleanup();
          reject(new Error("interrupted"));
          return;
        }
        if (byte === 0x08 || byte === 0x7f) {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        buf += String.fromCharCode(byte);
        process.stdout.write("*");
      }
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
