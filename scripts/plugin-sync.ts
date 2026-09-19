/**
 * Writes the parts of `plugin/` that are derived from the code, so the plugin
 * cannot say something the server does not.
 *
 * Two files: the skill, which is `skillDocument()` verbatim -- the same text
 * `pnpm install:mcp --write-skill` writes and the server sends at initialize
 * -- and the manifest's version, which follows `package.json` the way
 * `server.json` and `SERVER_INFO` do. `scripts/plugin.test.ts` reads both back
 * and fails when either has drifted, which is what makes running this on a
 * change to `BASE` a build step rather than a habit.
 *
 * Nothing else in `plugin/` is generated: `.mcp.json`, `hooks/hooks.json` and
 * the README are written by hand and read by a person.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { skillDocument } from "../mcp/tools";

export const PLUGIN_ROOT = join(__dirname, "..", "plugin");
export const SKILL_PATH = join(PLUGIN_ROOT, "skills", "todox", "SKILL.md");
export const MANIFEST_PATH = join(PLUGIN_ROOT, ".claude-plugin", "plugin.json");

/** What the checked-in skill must equal. */
export const expectedSkill = (): string => skillDocument();

/** What the checked-in manifest's `version` must equal. */
export const expectedVersion = (): string =>
  (JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as { version: string })
    .version;

/** The manifest with its version set, formatted the way it is checked in. */
export function manifestWithVersion(raw: string, version: string): string {
  const manifest = JSON.parse(raw) as Record<string, unknown>;
  return `${JSON.stringify({ ...manifest, version }, null, 2)}\n`;
}

if (require.main === module) {
  writeFileSync(SKILL_PATH, expectedSkill());
  writeFileSync(MANIFEST_PATH, manifestWithVersion(readFileSync(MANIFEST_PATH, "utf8"), expectedVersion()));
  console.log(`wrote ${SKILL_PATH}`);
  console.log(`wrote ${MANIFEST_PATH} (version ${expectedVersion()})`);
}
