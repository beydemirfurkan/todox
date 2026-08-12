import { promises as fs } from "node:fs";

import { readJsonFile, writeJsonFile } from "./atomic-write";

/**
 * Root keys observed across JSON-based MCP clients. Tightly enumerated: a
 * typo at the call site should not silently write to a wrong key and then
 * read it back empty on `verify`.
 */
export type JsonHttpRootKey = "mcpServers" | "servers" | "mcp";

/** Where a server entry lives. Read or written. */
export type JsonHttpTarget = {
  /** Absolute path to the JSON config file. Resolved by the caller per call. */
  configPath: string;
  /** Root key under which the entry is nested (`mcpServers`, `servers`, `mcp`). */
  rootKey: JsonHttpRootKey;
  /** Entry identifier (e.g. `todox`). */
  name: string;
};

export type JsonHttpInstallResult = {
  path: string;
  status: "created" | "updated";
};

/**
 * Insert or replace `name` under `rootKey`, leaving sibling entries alone.
 * Returns `updated` when the entry already existed; `created` otherwise.
 * `writeJsonFile` handles the EPERM / EACCES retry that Windows introduces
 * around a held destination, so callers do not reimplement the rename dance.
 */
export async function installJsonHttp(
  target: JsonHttpTarget,
  entry: Record<string, unknown>,
): Promise<JsonHttpInstallResult> {
  const current = (await readJsonFile<Record<string, unknown>>(target.configPath)) ?? {};
  const container = (current[target.rootKey] as Record<string, unknown> | undefined) ?? {};
  const existed = target.name in container;
  container[target.name] = entry;
  current[target.rootKey] = container;
  await writeJsonFile(target.configPath, current);
  return { path: target.configPath, status: existed ? "updated" : "created" };
}

/**
 * Confirm `name` is present under `rootKey` at `configPath`. When
 * `headersContain` is given, also assert the entry's
 * `headers.Authorization` starts with it -- catches a half-written config or
 * one the user has hand-edited away from `Bearer `.
 */
export async function verifyJsonHttp(
  target: JsonHttpTarget,
  headersContain?: string,
): Promise<{ ok: boolean; detail: string }> {
  const cfg = await readJsonFile<Record<string, Record<string, unknown>>>(target.configPath);
  const entry = cfg?.[target.rootKey]?.[target.name];
  if (!entry) {
    return {
      ok: false,
      detail: `no ${target.rootKey}.${target.name} in ${target.configPath}`,
    };
  }
  if (headersContain !== undefined) {
    const auth =
      (entry as { headers?: { Authorization?: string } }).headers?.Authorization ?? "";
    if (!auth.startsWith(headersContain)) {
      // Trim trailing whitespace so "Bearer " doesn't render as "Bearer  in".
      const label = headersContain.replace(/\s+$/, "");
      return {
        ok: false,
        detail: `Authorization header missing or not ${label} in ${target.configPath}`,
      };
    }
  }
  return { ok: true, detail: target.configPath };
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
