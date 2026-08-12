import { ENTRY_NAME, vsCodeContract } from "./contract";
import {
  detectJsonHttp,
  findStaleEntries,
  installJsonHttp,
  verifyJsonHttp,
} from "./json-http";
import type { ClientInstaller } from "./types";

/**
 * The path and the root key come from `vsCodeContract()`, resolved per call
 * because it reads `process.platform` and `APPDATA` at call time. Nothing in
 * this file names either one: this is the installer that wrote a macOS config
 * to the Linux path for a release and confirmed it by reading the same wrong
 * path back.
 */
const target = () => ({ ...vsCodeContract().current, name: ENTRY_NAME });

export const client: ClientInstaller = {
  name: "vscode",
  async detect() {
    return detectJsonHttp(vsCodeContract().current.file);
  },
  async install({ transport, url, token }) {
    if (transport !== "http") {
      throw new Error("vscode currently supports the http transport only");
    }
    const contract = vsCodeContract();
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
    return findStaleEntries(vsCodeContract().stale, ENTRY_NAME);
  },
};
