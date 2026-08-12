import * as os from "node:os";
import * as path from "node:path";

import { detectJsonHttp, installJsonHttp, verifyJsonHttp } from "./json-http";
import type { ClientInstaller } from "./types";

const NAME = "todox";

/**
 * Resolved per call, not once at import. `os.homedir()` reads the environment
 * at call time -- a module-level constant would freeze the value the module
 * first loaded with, which is before any test can point HOME somewhere safe.
 */
function configPath(): string {
  return path.join(os.homedir(), ".cursor", "mcp.json");
}

export const client: ClientInstaller = {
  name: "cursor",
  async detect() {
    return detectJsonHttp(configPath());
  },
  async install({ transport, url, token }) {
    if (transport !== "http") {
      throw new Error("cursor currently supports the http transport only");
    }
    const result = await installJsonHttp(
      { configPath: configPath(), rootKey: "mcpServers", name: NAME },
      { url, headers: { Authorization: `Bearer ${token}` } },
    );
    return { ...result, entryId: NAME };
  },
  async verify() {
    return verifyJsonHttp({ configPath: configPath(), rootKey: "mcpServers", name: NAME });
  },
};
