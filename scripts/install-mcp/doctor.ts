import { pathToFileURL } from "node:url";

import { runInstallDoctor } from "../../mcp/doctor";
import { runDoctor } from "./reachability";

export { runDoctor, type DoctorReport } from "./reachability";

/**
 * `pnpm mcp:doctor`, from a clone.
 *
 * Two shapes, told apart by the arguments. With a url and a token it is the
 * reachability check on its own: is THIS server answering THIS token from
 * this machine. With none it is the install inspection `todox-mcp doctor`
 * runs from the package -- which config files carry a todox entry, whether
 * the client will read them, and whether the habit is in the memory file --
 * followed by the same reachability check against every entry it found.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "doctor") {
    process.exit(await runInstallDoctor(argv[1] ?? process.cwd()));
  }

  const url = argv[0] ?? process.env.TODOX_URL ?? "https://www.todox.dev/api/mcp";
  const token = argv[1] ?? process.env.TODOX_TOKEN ?? "";
  const cwd = argv[2] ?? process.cwd();
  if (!token) {
    console.error(
      "[todox doctor] usage: pnpm mcp:doctor <url> <token> [cwd] (token may also come from $TODOX_TOKEN), " +
        "or pnpm mcp:doctor with no arguments to inspect this machine's installs",
    );
    process.exit(2);
  }
  const report = await runDoctor({ url, token, cwd });
  console.error(`[todox doctor] ${report.ok ? "ok" : "FAIL"} — ${report.detail}`);
  process.exit(report.ok ? 0 : 1);
}

// CLI shim: only run when this file is the script entry, not when imported
// from `index.ts`. `import.meta.url === pathToFileURL(process.argv[1]).href`
// is the standard tsx/Node ESM "is this the main module" check.
const argv1 = process.argv[1];
if (argv1) {
  try {
    if (import.meta.url === pathToFileURL(argv1).href) {
      main().catch((e: unknown) => {
        console.error("[todox doctor]", e instanceof Error ? e.message : e);
        process.exit(1);
      });
    }
  } catch {
    // process.argv[1] may not be a file URL on every platform; skip the shim.
  }
}
