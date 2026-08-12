import { cursorContract, ENTRY_NAME } from "./contract";
import {
  detectJsonHttp,
  findStaleEntries,
  installJsonHttp,
  verifyJsonHttp,
} from "./json-http";
import type { ClientInstaller } from "./types";

/**
 * Resolved per call: `cursorContract()` reads `os.homedir()` at call time, and
 * a module-level constant would freeze the value the module first loaded with
 * -- which is before any test can point HOME somewhere safe.
 */
const target = () => ({ ...cursorContract().current, name: ENTRY_NAME });

export const client: ClientInstaller = {
  name: "cursor",
  async detect() {
    return detectJsonHttp(cursorContract().current.file);
  },
  async install({ transport, url, token }) {
    if (transport !== "http") {
      throw new Error("cursor currently supports the http transport only");
    }
    const contract = cursorContract();
    const result = await installJsonHttp(
      { ...contract.current, name: ENTRY_NAME },
      { type: contract.httpType, url, headers: { Authorization: `Bearer ${token}` } },
    );
    return { ...result, entryId: ENTRY_NAME };
  },
  async verify() {
    return verifyJsonHttp(target(), "Bearer ");
  },
  async staleInstalls() {
    return findStaleEntries(cursorContract().stale, ENTRY_NAME);
  },
};
