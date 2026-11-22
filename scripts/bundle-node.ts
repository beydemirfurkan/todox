import { buildSync } from "esbuild";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..");

/**
 * One TypeScript entry point and everything it imports, as a single ES module
 * that needs nothing but node's built-ins.
 *
 * For the two scripts todox runs where no `node_modules` sits beside them:
 * the Claude Code plugin's hooks (copied into a plugin cache) and the git
 * hook (copied into `~/.todox`). Deterministic for one esbuild version,
 * pinned in package.json, and with no source map or absolute path in it, so
 * a checkout anywhere builds the same bytes.
 */
export function bundleNodeScript(entry: string, banner: string): string {
  const result = buildSync({
    entryPoints: [join(REPO_ROOT, entry)],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node18",
    legalComments: "none",
    banner: { js: banner },
    logLevel: "silent",
    absWorkingDir: REPO_ROOT,
  });
  return result.outputFiles[0].text;
}

/** Every module specifier a bundle still imports. */
export const importedSpecifiers = (bundle: string): string[] =>
  [...bundle.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

export const GIT_HOOK_ENTRY = "mcp/git-hook/index.ts";

/** The git hook as `todox-mcp hook install` copies it into `~/.todox`. */
export const gitHookBundle = (): string =>
  bundleNodeScript(
    GIT_HOOK_ENTRY,
    "// todox git hook, generated from mcp/git-hook/. Installed by `todox-mcp hook install`; re-run it to update.",
  );
