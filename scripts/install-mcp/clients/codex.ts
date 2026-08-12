import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { writeTextFile } from "./atomic-write";
import { upsertTomlServerSection } from "./toml";
import type { ClientInstaller } from "./types";

const NAME = "todox";

/**
 * Resolved per call, not once at import. `os.homedir()` is read from the
 * environment, so a module-level constant freezes whatever HOME happened to
 * be set when the module was first loaded -- which is before any test can
 * point it somewhere safe, and wrong for any caller that changes it.
 */
function configPath(): string {
  return path.join(os.homedir(), ".codex", "config.toml");
}

async function read(p: string): Promise<string> {
  try {
    return await fs.readFile(p, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
}

export const client: ClientInstaller = {
  name: "codex",
  async detect() {
    try {
      await fs.access(configPath());
      return true;
    } catch {
      return false;
    }
  },
  async install({ transport, url, token }) {
    if (transport !== "http") {
      throw new Error("codex currently supports the http transport only");
    }
    const target = configPath();
    const existing = await read(target);
    const { text, status } = upsertTomlServerSection(existing, NAME, {
      url,
      headerName: "Authorization",
      headerValue: `Bearer ${token}`,
    });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await writeTextFile(target, text);
    return { path: target, status, entryId: NAME };
  },
  async verify() {
    const target = configPath();
    const text = await read(target);
    if (!text.includes(`[mcp_servers.${NAME}]`)) {
      return { ok: false, detail: `no [mcp_servers.${NAME}] in ${target}` };
    }
    if (!text.includes("Bearer ")) {
      return { ok: false, detail: `Authorization header missing in ${target}` };
    }
    return { ok: true, detail: target };
  },
};
