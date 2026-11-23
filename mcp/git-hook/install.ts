import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { findProjectRoot, gitConfigValue, gitDir } from "../workspace";
import { saveCredentials } from "../saved-config";
import { configPath, todoxHome } from "./config";

/**
 * `todox-mcp hook install|uninstall|status`: put the git hook into one
 * repository, take it out, or say whether it is there.
 *
 * Per repository on purpose (decision on task #808): a global
 * `core.hooksPath` would change git for every repository on the machine and
 * would silently lose to any repository that sets its own, which every husky
 * setup does. So this touches one repository's `.git/hooks`, and only between
 * its own markers:
 *
 * - an existing hook is kept, and the block goes in before a trailing `exit`,
 *   where an appended line would never run;
 * - a hook written in something other than sh is not edited -- the line is
 *   printed for the developer to place;
 * - a repository whose hooks live in the working tree (`core.hooksPath`, as
 *   husky and lefthook set it) is not edited either: those files are
 *   committed, and a line pointing into this user's home does not belong in
 *   everyone's checkout.
 */
export const HOOKS = ["post-commit", "post-rewrite"] as const;
export const BEGIN = "# >>> todox git hook (todox-mcp hook install) >>>";
export const END = "# <<< todox git hook <<<";

type Env = Record<string, string | undefined>;

export interface HookTarget {
  /** The repository's root and git dir, or a reason it cannot take a hook. */
  root: string;
  hooksDir: string;
}

export function hookLine(home: string, event: string): string {
  // Detached and silent: git has already made the commit, and nothing this
  // starts may make the developer wait for it or see it.
  // Forward slashes: on Windows this line is run by Git Bash, which reads a
  // backslash inside double quotes as the start of an escape.
  // TODOX_HOME stated rather than assumed: the hook reads its token from
  // there, and git runs it under whatever environment ran `git commit`.
  const dir = home.replace(/\\/g, "/");
  return `command -v node >/dev/null 2>&1 && (TODOX_HOME="${dir}" node "${dir}/git-hook.mjs" ${event} </dev/null >/dev/null 2>&1 &)`;
}

export const blockFor = (home: string, event: string): string => `${BEGIN}\n${hookLine(home, event)}\n${END}`;

/** Where the hooks go, or why they cannot go anywhere this command may write. */
export function locate(cwd: string): HookTarget | { refused: string } {
  const root = findProjectRoot(cwd);
  const dir = gitDir(root);
  if (!dir) return { refused: `${cwd} is not inside a git repository` };
  const hooksPath = gitConfigValue(root, "core.hooksPath");
  if (hooksPath)
    return {
      refused:
        `this repository keeps its hooks in ${hooksPath} (core.hooksPath -- husky or lefthook, usually). ` +
        `Those files are shared with everyone who clones it, so todox does not edit them. Add this to its ` +
        `post-commit and post-rewrite hooks yourself, with the event name changed to match:\n  ` +
        hookLine("$HOME/.todox", "post-commit"),
    };
  return { root, hooksDir: join(dir, "hooks") };
}

/** A hook file with the todox block in it, replaced if one was already there. */
export function withBlock(existing: string | undefined, block: string): string | { refused: string } {
  if (existing === undefined || !existing.trim()) return `#!/bin/sh\n${block}\n`;
  const shebang = existing.split("\n", 1)[0];
  if (shebang.startsWith("#!") && !/\b(sh|bash|zsh|dash|ksh)\b/.test(shebang))
    return { refused: `the existing hook runs with \`${shebang.slice(2).trim()}\`, not a shell` };

  const without = withoutBlock(existing);
  const lines = without.replace(/\n+$/, "").split("\n");
  const last = lines.at(-1) ?? "";
  if (/^\s*exit\b/.test(last)) return `${[...lines.slice(0, -1), block, last].join("\n")}\n`;
  return `${[...lines, block].join("\n")}\n`;
}

/** The hook file with the todox block taken out; the rest exactly as it was. */
export function withoutBlock(existing: string): string {
  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END);
  if (start === -1 || end === -1 || end < start) return existing;
  const before = existing.slice(0, start).replace(/\n$/, "");
  const after = existing.slice(end + END.length).replace(/^\n/, "");
  return [before, after].filter(Boolean).join("\n").replace(/\n*$/, "\n");
}

export interface InstallOptions {
  cwd: string;
  env: Env;
  /** The built git-hook.mjs to copy into place. */
  bundle: string;
  token?: string;
  url?: string;
}

export interface Report {
  ok: boolean;
  lines: string[];
}

export function install(o: InstallOptions): Report {
  const target = locate(o.cwd);
  if ("refused" in target) return { ok: false, lines: [target.refused] };
  if (!existsSync(o.bundle))
    return { ok: false, lines: [`no git hook bundle at ${o.bundle}: run this from the todox-mcp package`] };

  const home = todoxHome(o.env);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  copyFileSync(o.bundle, join(home, "git-hook.mjs"));
  const lines = [`copied the hook to ${join(home, "git-hook.mjs")}`, ...saveConfig(o)];

  mkdirSync(target.hooksDir, { recursive: true });
  let ok = true;
  for (const event of HOOKS) {
    const path = join(target.hooksDir, event);
    const next = withBlock(existsSync(path) ? readFileSync(path, "utf8") : undefined, blockFor(home, event));
    if (typeof next !== "string") {
      ok = false;
      lines.push(`${event}: left alone, ${next.refused}. Add this line to it yourself:\n  ${hookLine(home, event)}`);
      continue;
    }
    writeFileSync(path, next);
    chmodSync(path, 0o755);
    lines.push(`${event}: installed in ${path}`);
  }
  return { ok, lines };
}

function saveConfig(o: InstallOptions): string[] {
  const path = configPath(o.env);
  const token = o.token ?? o.env.TODOX_TOKEN;
  if (!token)
    return existsSync(path)
      ? [`kept the token already in ${path}`]
      : [`no token given: the hook will log "no token" until you re-run with --token todox_… or set TODOX_TOKEN`];
  const url = o.url ?? o.env.TODOX_URL;
  saveCredentials(o.env, { token, url });
  return [`saved the token${url ? ` and ${url}` : ""} to ${path} (readable by you only)`];
}

export function uninstall(cwd: string, env: Env): Report {
  const target = locate(cwd);
  if ("refused" in target) return { ok: false, lines: [target.refused] };
  const lines: string[] = [];
  for (const event of HOOKS) {
    const path = join(target.hooksDir, event);
    if (!existsSync(path) || !readFileSync(path, "utf8").includes(BEGIN)) {
      lines.push(`${event}: no todox block`);
      continue;
    }
    const rest = withoutBlock(readFileSync(path, "utf8"));
    if (/^(#![^\n]*\n)?\s*$/.test(rest)) unlinkSync(path);
    else writeFileSync(path, rest);
    lines.push(`${event}: removed the todox block from ${path}`);
  }
  lines.push(`left ${todoxHome(env)} in place: other repositories may still use it`);
  return { ok: true, lines };
}

/** What is installed for one repository: read only, never the token itself. */
export interface HookState {
  root: string;
  installed: (typeof HOOKS)[number][];
  script: string | undefined;
  token: "env" | "saved" | "none";
}

export function hookState(cwd: string, env: Env): HookState | { refused: string } {
  const target = locate(cwd);
  if ("refused" in target) return target;
  const script = join(todoxHome(env), "git-hook.mjs");
  return {
    root: target.root,
    installed: HOOKS.filter((event) => {
      const path = join(target.hooksDir, event);
      return existsSync(path) && readFileSync(path, "utf8").includes(BEGIN);
    }),
    script: existsSync(script) ? script : undefined,
    token: env.TODOX_TOKEN ? "env" : existsSync(configPath(env)) ? "saved" : "none",
  };
}

export function status(cwd: string, env: Env): Report {
  const state = hookState(cwd, env);
  if ("refused" in state) return { ok: false, lines: [state.refused] };
  const token = { env: "from TODOX_TOKEN", saved: `saved in ${configPath(env)}`, none: "none" }[state.token];
  return {
    ok: true,
    lines: [
      ...HOOKS.map((event) => `${event}: ${state.installed.includes(event) ? "installed" : "not installed"}`),
      `hook script: ${state.script ?? "missing -- run install"}`,
      `token: ${token}`,
      `log: ${join(todoxHome(env), "git-hook", "hook.log")}`,
    ],
  };
}
