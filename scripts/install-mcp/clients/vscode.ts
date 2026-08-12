import * as path from "node:path";

import { detectJsonHttp, installJsonHttp, verifyJsonHttp } from "./json-http";
import { vsCodeConfigDir } from "./paths";
import type { ClientInstaller } from "./types";

const NAME = "todox";

/**
 * Resolved per call: `vsCodeConfigDir()` reads `process.platform` and
 * `APPDATA` at call time, and caching would freeze both to whatever they
 * were when the module first loaded.
 */
function configPath(): string {
  return path.join(vsCodeConfigDir(), "mcp.json");
}

export const client: ClientInstaller = {
  name: "vscode",
  async detect() {
    return detectJsonHttp(configPath());
  },
  async install({ transport, url, token }) {
    if (transport !== "http") {
      throw new Error("vscode currently supports the http transport only");
    }
    // VS Code uses root key `servers`, not `mcpServers`. Mixing them up is
    // the single most common install bug for this client.
    const result = await installJsonHttp(
      { configPath: configPath(), rootKey: "servers", name: NAME },
      { type: "http", url, headers: { Authorization: `Bearer ${token}` } },
    );
    return { ...result, entryId: NAME };
  },
  async verify() {
    return verifyJsonHttp({ configPath: configPath(), rootKey: "servers", name: NAME });
  },
};
