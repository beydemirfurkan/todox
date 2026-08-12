import { promises as fs } from "node:fs";

import { readJsonFile, writeJsonFile } from "./atomic-write";
import type { ServerLayout } from "./contract";

/**
 * Read and write server entries in a JSON MCP config.
 *
 * Where an entry belongs is not decided here: callers pass a `ServerLayout`
 * from `contract.ts`, which is the only place a path or a root key is written
 * down. The root key used to be a union typed at each call site, on the theory
 * that a typo should not write to a wrong key -- but a call site that names its
 * own key is free to name a consistent wrong one, which is what VS Code on
 * macOS did for a release.
 */

/** Where an entry lives, plus which entry. */
export type JsonHttpTarget = ServerLayout & {
  /** Entry identifier (e.g. `todox`). */
  name: string;
};

export type JsonHttpInstallResult = {
  path: string;
  status: "created" | "updated";
};

/** Human-readable `mcp.servers.todox`, for messages. */
function describe(target: JsonHttpTarget): string {
  return [...target.rootKeys, target.name].join(".");
}

/**
 * Walk to the map of server entries, creating the intermediate objects that
 * are missing. A key that exists but holds something other than an object is
 * an error rather than something to overwrite: replacing it would discard
 * whatever the user had there, which is the failure mode this module exists
 * to stop making.
 */
function containerFor(
  doc: Record<string, unknown>,
  target: JsonHttpTarget,
): Record<string, unknown> {
  let node = doc;
  for (const key of target.rootKeys) {
    const existing = node[key];
    if (existing === undefined) {
      const created: Record<string, unknown> = {};
      node[key] = created;
      node = created;
      continue;
    }
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
      throw new Error(
        `cannot write ${describe(target)}: '${key}' is already set to a non-object; ` +
          "fix that config by hand rather than letting this overwrite it",
      );
    }
    node = existing as Record<string, unknown>;
  }
  return node;
}

/** Walk to the map of server entries without creating anything. */
function readContainer(
  doc: Record<string, unknown> | null,
  rootKeys: readonly string[],
): Record<string, unknown> | undefined {
  let node: unknown = doc;
  for (const key of rootKeys) {
    if (typeof node !== "object" || node === null || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  if (typeof node !== "object" || node === null || Array.isArray(node)) return undefined;
  return node as Record<string, unknown>;
}

/**
 * Insert or replace `name` at the target layout, leaving sibling entries
 * alone. Returns `updated` when the entry already existed; `created`
 * otherwise. `writeJsonFile` handles the EPERM / EACCES retry that Windows
 * introduces around a held destination, so callers do not reimplement the
 * rename dance.
 */
export async function installJsonHttp(
  target: JsonHttpTarget,
  entry: Record<string, unknown>,
): Promise<JsonHttpInstallResult> {
  const current = (await readJsonFile<Record<string, unknown>>(target.file)) ?? {};
  const container = containerFor(current, target);
  const existed = target.name in container;
  container[target.name] = entry;
  await writeJsonFile(target.file, current);
  return { path: target.file, status: existed ? "updated" : "created" };
}

/**
 * Confirm `name` is present at the target layout. When `headersContain` is
 * given, also assert the entry's `headers.Authorization` starts with it --
 * catches a half-written config or one the user has hand-edited away from
 * `Bearer `.
 *
 * This still reads back a file the installer just wrote, and on its own that
 * proves only that the write landed. What makes it worth running is that the
 * path and keys come from the contract rather than from the installer, so a
 * disagreement between the two shows up here instead of at the agent's first
 * session.
 */
export async function verifyJsonHttp(
  target: JsonHttpTarget,
  headersContain?: string,
): Promise<{ ok: boolean; detail: string }> {
  const doc = await readJsonFile<Record<string, unknown>>(target.file);
  const entry = readContainer(doc, target.rootKeys)?.[target.name];
  if (!entry) {
    return { ok: false, detail: `no ${describe(target)} in ${target.file}` };
  }
  if (headersContain !== undefined) {
    const auth =
      (entry as { headers?: { Authorization?: string } }).headers?.Authorization ?? "";
    if (!auth.startsWith(headersContain)) {
      // Trim trailing whitespace so "Bearer " doesn't render as "Bearer  in".
      const label = headersContain.replace(/\s+$/, "");
      return {
        ok: false,
        detail: `Authorization header missing or not ${label} in ${target.file}`,
      };
    }
  }
  return { ok: true, detail: target.file };
}

/**
 * Layouts that hold a todox entry the client will not read -- an install from
 * a version that wrote the wrong path or the wrong key. Returned as
 * descriptions rather than deleted: the file may be one the user maintains by
 * hand, and a CLI that quietly removes config is a worse surprise than the one
 * it is reporting.
 */
export async function findStaleEntries(
  layouts: readonly ServerLayout[],
  name: string,
): Promise<string[]> {
  const found: string[] = [];
  for (const layout of layouts) {
    const target = { ...layout, name };
    // A stale layout is a guess about the past, so an unreadable or hand-broken
    // file there must not fail the install that is otherwise fine.
    const doc = await readJsonFile<Record<string, unknown>>(layout.file).catch(() => null);
    if (readContainer(doc, layout.rootKeys)?.[name] !== undefined) {
      found.push(`${describe(target)} in ${layout.file}`);
    }
  }
  return found;
}

/** True when the config file exists at all. Cheap path probe. */
export async function detectJsonHttp(configPath: string): Promise<boolean> {
  try {
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}
