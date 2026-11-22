import { workspaceGit } from "../hook/git";
import { fileLogger } from "../hook/log";
import { createClient } from "../rpc-client";
import { gitDir, gitParent, gitRemote } from "../workspace";
import { gitHookConfig, todoxHome } from "./config";
import { observeCommit, type Outcome } from "./observe-commit";

/**
 * `node git-hook.mjs <post-commit|post-rewrite>`, run in the background by
 * the lines `todox-mcp hook install` adds to a repository's hooks.
 *
 * Nothing it does can reach the commit: it runs after the commit exists, the
 * installed line detaches it, and every failure lands in
 * `~/.todox/git-hook/hook.log` and exits 0.
 */
const RPC_TIMEOUT_MS = 4_000;
const EVENTS = new Set(["post-commit", "post-rewrite"]);

export async function runGitHook(
  event: string,
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<Outcome | "disabled" | "no-token" | "unknown-event" | "failed"> {
  const log = fileLogger(`${todoxHome(env)}/git-hook`);
  if (!EVENTS.has(event)) {
    log(event, "unknown git hook event");
    return "unknown-event";
  }
  const config = gitHookConfig(env, (m) => log(event, m));
  if (config.disabled) return "disabled";
  if (!config.token) {
    log(event, "no token: run `todox-mcp hook install --token …` or set TODOX_TOKEN");
    return "no-token";
  }
  try {
    return await observeCommit({
      event,
      cwd,
      git: { ...workspaceGit, parent: gitParent, gitDir, remote: gitRemote },
      rpc: createClient(config.url, config.token, {
        headers: { "x-todox-carrier": "git-hook" },
        timeoutMs: RPC_TIMEOUT_MS,
      }),
      log,
      now: () => new Date(),
    });
  } catch (e) {
    log(event, `not recorded: ${(e as Error).message}`);
    return "failed";
  }
}

if (process.argv[1]?.endsWith("git-hook.mjs")) {
  runGitHook(process.argv[2] ?? "", process.cwd(), process.env).catch((e) => {
    process.stderr.write(`todox git hook: ${(e as Error).message}\n`);
  });
}
