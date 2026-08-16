import * as os from "node:os";
import * as path from "node:path";

import {
  MCP_MEMORY_PATHS,
  MCP_SHAPES,
  MEMORY_FILE_NAME,
  type McpClientId,
  type McpConfigLocation,
} from "../../../lib/mcp-clients";
import { expandHome, vsCodeConfigDir, vsCodeStaleConfigDirs } from "./paths";

/**
 * Where each client reads its MCP config, and under which keys. One table,
 * read by the installer, by `verify`, and by the tests.
 *
 * The point is that no installer states a path or a root key of its own. Both
 * halves of a wrong install used to come from the same constant at the same
 * call site: `installJsonHttp` wrote `~/.config/Code/User/mcp.json` on macOS
 * and `verifyJsonHttp` read it back from there, so "does VS Code read this
 * file?" was never a question anyone asked. Routing both through one table
 * does not make the table correct -- it makes it the single thing to correct,
 * and the platform matrix in `contract.test.ts` is what holds it to that.
 *
 * Every entry here is a claim about someone else's software. `stale` is the
 * memory of the claims we got wrong: layouts a released todox wrote that the
 * client does not read. `install` reports them so a machine that ran the
 * broken version is not left with two configs and no way to tell which is
 * live.
 */

/** A place a server entry can live: which file, and the key path inside it. */
export type ServerLayout = {
  /** Absolute path to the config file. */
  readonly file: string;
  /** Keys from the document root down to the map of server entries. */
  readonly rootKeys: readonly string[];
};

export type JsonClientContract = {
  /** The layout this client reads on this platform. */
  readonly current: ServerLayout;
  /** Layouts this client does not read, but some todox version wrote. */
  readonly stale: readonly ServerLayout[];
  /**
   * `type` value the client expects on a remote server entry. The values are
   * not interchangeable and a wrong one is ignored without an error, which is
   * why it belongs beside the key path rather than at the call site.
   */
  readonly httpType: string;
};

/** The entry name todox registers itself under, in every client. */
export const ENTRY_NAME = "todox";

/**
 * Resolved per call, never cached at module scope: `os.homedir()` and
 * `process.platform` are read at call time, and a module-level constant would
 * freeze whichever values happened to be set when the module first loaded --
 * before any test can point HOME somewhere safe.
 */
export function claudeCodeContract(): JsonClientContract {
  return {
    current: {
      file: path.join(os.homedir(), ".claude.json"),
      rootKeys: MCP_SHAPES["claude-code"].rootKeys,
    },
    stale: [],
    httpType: MCP_SHAPES["claude-code"].remoteType,
  };
}

export function cursorContract(): JsonClientContract {
  return {
    current: {
      file: path.join(os.homedir(), ".cursor", "mcp.json"),
      rootKeys: MCP_SHAPES.cursor.rootKeys,
    },
    stale: [],
    httpType: MCP_SHAPES.cursor.remoteType,
  };
}

/**
 * VS Code's root key is `servers`, not `mcpServers` -- the single most common
 * install bug for this client, and one the README's own table had backwards.
 */
export function vsCodeContract(): JsonClientContract {
  return {
    current: {
      file: path.join(vsCodeConfigDir(), "mcp.json"),
      rootKeys: MCP_SHAPES.vscode.rootKeys,
    },
    stale: vsCodeStaleConfigDirs().map((dir) => ({
      file: path.join(dir, "mcp.json"),
      rootKeys: MCP_SHAPES.vscode.rootKeys,
    })),
    httpType: MCP_SHAPES.vscode.remoteType,
  };
}

/**
 * OpenCode moved the server map one level down between major versions: v1
 * keyed servers directly under `mcp`, v2 nests them under `mcp.servers`. Both
 * are the same file, so the version we did not write is the stale layout --
 * and writing the wrong one is silent, the server simply never appears.
 *
 * `type` is `"remote"` here, not `"http"`. The Claude/Cursor/VS Code value is
 * accepted into the file and then ignored.
 */
export function openCodeContract(major: OpenCodeMajor): JsonClientContract {
  const file = path.join(os.homedir(), ".config", "opencode", "opencode.json");
  const v1: ServerLayout = { file, rootKeys: MCP_SHAPES["opencode-v1"].rootKeys };
  const v2: ServerLayout = { file, rootKeys: MCP_SHAPES["opencode-v2"].rootKeys };
  return {
    current: major === "v2" ? v2 : v1,
    stale: [major === "v2" ? v1 : v2],
    httpType: MCP_SHAPES[`opencode-${major}`].remoteType,
  };
}

export type OpenCodeMajor = "v1" | "v2";

/** Codex is TOML, so it has a file but no JSON key path. */
export function codexConfigFile(): string {
  return path.join(os.homedir(), ".codex", "config.toml");
}

/**
 * The absolute file the habit goes in, for a client.
 *
 * Same division of labour as the config paths above: `lib/mcp-clients.ts` holds
 * the `~`-form locations so the Account page can print them in a browser, and
 * the resolving to an absolute path happens here, where `node:` is available.
 *
 * Where the client reads a directory of instruction files rather than one file,
 * todox writes its own file inside it. Appending to a file the user did not
 * create for us is a worse neighbour than adding one they can delete.
 */
export function memoryFileFor(client: McpClientId): string {
  const target = MCP_MEMORY_PATHS[client];
  const resolved = expandHome(target.location[platformKey()]);
  return target.kind === "directory"
    ? path.join(resolved, MEMORY_FILE_NAME)
    : resolved;
}

function platformKey(): keyof McpConfigLocation {
  if (process.platform === "win32") return "win32";
  if (process.platform === "darwin") return "darwin";
  return "linux";
}
