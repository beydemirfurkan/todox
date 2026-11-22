import { join } from "node:path";

import { install, type Report, status, uninstall } from "./install";

/**
 * `todox-mcp hook <install|uninstall|status> [--repo <dir>] [--token <t>] [--url <u>]`.
 *
 * The bundle ships at the package root (`pnpm pack:mcp` writes it there), two
 * levels above this file once compiled; `--bundle` points elsewhere, for
 * running from a clone.
 */
const USAGE =
  "usage: todox-mcp hook <install|uninstall|status> [--repo <dir>] [--token <todox_…>] [--url <https://…>]";

export function parseHookArgs(argv: string[]): { command?: string; flags: Record<string, string> } {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const match = /^--(repo|token|url|bundle)(?:=(.*))?$/.exec(rest[i]);
    if (!match) throw new Error(`unknown argument ${rest[i]}\n${USAGE}`);
    const value = match[2] ?? rest[++i];
    if (value === undefined) throw new Error(`--${match[1]} needs a value\n${USAGE}`);
    flags[match[1]] = value;
  }
  return { command, flags };
}

export function runHookCommand(argv: string[], env: Record<string, string | undefined>, cwd: string): number {
  const { command, flags } = parseHookArgs(argv);
  const repo = flags.repo ?? cwd;
  const report = dispatch(command, { repo, flags, env });
  for (const line of report.lines) console.log(`[todox hook] ${line}`);
  return report.ok ? 0 : 1;
}

function dispatch(
  command: string | undefined,
  o: { repo: string; flags: Record<string, string>; env: Record<string, string | undefined> },
): Report {
  if (command === "install")
    return install({
      cwd: o.repo,
      env: o.env,
      bundle: o.flags.bundle ?? join(__dirname, "..", "..", "git-hook.mjs"),
      token: o.flags.token,
      url: o.flags.url,
    });
  if (command === "uninstall") return uninstall(o.repo, o.env);
  if (command === "status") return status(o.repo, o.env);
  return { ok: false, lines: [USAGE] };
}
