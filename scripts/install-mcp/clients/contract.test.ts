import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as os from "node:os";
import * as path from "node:path";

import { MCP_CONFIG_PATHS, MCP_SHAPES } from "../../../lib/mcp-clients";
import {
  claudeCodeContract,
  codexConfigFile,
  cursorContract,
  openCodeContract,
  vsCodeContract,
  type JsonClientContract,
} from "./contract";

/**
 * The platform matrix. Every location below is a claim about where somebody
 * else's software looks for its config, and the reason this file exists is
 * that such a claim cannot be checked by writing a file and reading it back --
 * which is exactly what `install` followed by `verify` does.
 *
 * VS Code on macOS is the case that shipped wrong: the installer used the
 * Linux path, and because `~/.config/Code/User` does not exist on a Mac,
 * writing to it succeeded, created the tree and verified clean while VS Code
 * read a different file entirely. The suite had win32 and linux cases; the
 * platform the developers were on was the one nobody asserted.
 */

/**
 * `process.platform` is a plain value property, so `vi.spyOn` cannot see it.
 * Restoring it is not optional: vitest reuses a worker across files, and a
 * leaked "win32" would follow this suite into the next one.
 */
function withPlatform<T>(platform: NodeJS.Platform, body: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    return body();
  } finally {
    if (original) Object.defineProperty(process, "platform", original);
  }
}

const PLATFORMS = ["darwin", "linux", "win32"] as const;

let savedAppData: string | undefined;

beforeEach(() => {
  savedAppData = process.env.APPDATA;
});

afterEach(() => {
  if (savedAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = savedAppData;
});

describe("vscode contract", () => {
  it("uses Application Support on darwin, not the Linux XDG path", () => {
    withPlatform("darwin", () => {
      expect(vsCodeContract().current.file).toBe(
        path.join(
          os.homedir(),
          "Library",
          "Application Support",
          "Code",
          "User",
          "mcp.json",
        ),
      );
    });
  });

  it("uses ~/.config on linux", () => {
    withPlatform("linux", () => {
      expect(vsCodeContract().current.file).toBe(
        path.join(os.homedir(), ".config", "Code", "User", "mcp.json"),
      );
    });
  });

  it("uses APPDATA on win32", () => {
    withPlatform("win32", () => {
      process.env.APPDATA = path.join(os.homedir(), "AppData", "Roaming");
      expect(vsCodeContract().current.file).toBe(
        path.join(os.homedir(), "AppData", "Roaming", "Code", "User", "mcp.json"),
      );
    });
  });

  it("names the Linux path as stale on darwin, so a broken install is reported", () => {
    withPlatform("darwin", () => {
      expect(vsCodeContract().stale.map((layout) => layout.file)).toEqual([
        path.join(os.homedir(), ".config", "Code", "User", "mcp.json"),
      ]);
    });
  });

  it("has nothing stale on the platforms that were always right", () => {
    for (const platform of ["linux", "win32"] as const) {
      withPlatform(platform, () => {
        if (platform === "win32") process.env.APPDATA = path.join(os.homedir(), "AppData");
        expect(vsCodeContract().stale).toEqual([]);
      });
    }
  });

  it("keys servers under `servers`, never `mcpServers`", () => {
    // The single most common install bug for this client, and one the README's
    // own agent table had backwards.
    for (const platform of PLATFORMS) {
      withPlatform(platform, () => {
        expect(vsCodeContract().current.rootKeys).toEqual(["servers"]);
      });
    }
  });
});

describe("home-relative clients", () => {
  const cases = [
    { name: "claude-code", contract: claudeCodeContract, file: [".claude.json"] },
    { name: "cursor", contract: cursorContract, file: [".cursor", "mcp.json"] },
  ] as const;

  for (const { name, contract, file } of cases) {
    it(`${name} resolves to the same home-relative path on every platform`, () => {
      for (const platform of PLATFORMS) {
        withPlatform(platform, () => {
          expect(contract().current.file).toBe(path.join(os.homedir(), ...file));
          expect(contract().current.rootKeys).toEqual(["mcpServers"]);
          expect(contract().stale).toEqual([]);
        });
      }
    });
  }

  it("codex resolves to ~/.codex/config.toml on every platform", () => {
    for (const platform of PLATFORMS) {
      withPlatform(platform, () => {
        expect(codexConfigFile()).toBe(path.join(os.homedir(), ".codex", "config.toml"));
      });
    }
  });
});

describe("opencode contract", () => {
  const file = () => path.join(os.homedir(), ".config", "opencode", "opencode.json");

  it("keys servers directly under `mcp` on v1", () => {
    expect(openCodeContract("v1").current).toEqual({ file: file(), rootKeys: ["mcp"] });
  });

  it("nests servers under `mcp.servers` on v2", () => {
    expect(openCodeContract("v2").current).toEqual({
      file: file(),
      rootKeys: ["mcp", "servers"],
    });
  });

  it("treats the other major's layout as the stale one, in the same file", () => {
    // Both layouts live in one file, so "stale" here is a key path rather than
    // a path on disk -- which is why the contract carries layouts, not paths.
    expect(openCodeContract("v2").stale).toEqual([{ file: file(), rootKeys: ["mcp"] }]);
    expect(openCodeContract("v1").stale).toEqual([
      { file: file(), rootKeys: ["mcp", "servers"] },
    ]);
  });

  it("uses `remote` as the type, not `http`", () => {
    // The Claude/Cursor/VS Code value is accepted into the file and ignored.
    expect(openCodeContract("v1").httpType).toBe("remote");
    expect(openCodeContract("v2").httpType).toBe("remote");
  });
});

/**
 * The installer resolves absolute paths; `lib/mcp-clients.ts` carries the same
 * locations written the way a human reads them, for the README and for the
 * snippets the Account page hands out. Two spellings of one fact, so this is
 * the test that stops them becoming two facts.
 */
describe("contract agrees with the documented locations", () => {
  /** `~/a/b` and `%APPDATA%\a\b` resolved the way the installer would. */
  function absolute(documented: string, platform: NodeJS.Platform): string {
    if (documented.startsWith("%APPDATA%")) {
      const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
      return path.join(appData, ...documented.replace("%APPDATA%\\", "").split("\\"));
    }
    void platform;
    return path.join(os.homedir(), ...documented.replace("~/", "").split("/"));
  }

  const cases = [
    { id: "claude-code", contract: claudeCodeContract },
    { id: "cursor", contract: cursorContract },
    { id: "vscode", contract: vsCodeContract },
  ] as const;

  for (const { id, contract } of cases) {
    it(`${id} resolves to the path the docs print, on every platform`, () => {
      for (const platform of PLATFORMS) {
        withPlatform(platform, () => {
          if (platform === "win32") {
            process.env.APPDATA = path.join(os.homedir(), "AppData", "Roaming");
          }
          const documented = MCP_CONFIG_PATHS[id][platform];
          expect(contract().current.file, `${id} on ${platform}`).toBe(
            absolute(documented, platform),
          );
        });
      }
    });
  }

  it("opencode resolves to the documented path", () => {
    expect(openCodeContract("v2").current.file).toBe(
      absolute(MCP_CONFIG_PATHS.opencode.linux, "linux"),
    );
  });

  it("codex resolves to the documented path", () => {
    expect(codexConfigFile()).toBe(absolute(MCP_CONFIG_PATHS.codex.linux, "linux"));
  });

  it("uses the shared shapes rather than its own copy of the root keys", () => {
    expect(vsCodeContract().current.rootKeys).toEqual(MCP_SHAPES.vscode.rootKeys);
    expect(openCodeContract("v1").current.rootKeys).toEqual(MCP_SHAPES["opencode-v1"].rootKeys);
    expect(openCodeContract("v2").current.rootKeys).toEqual(MCP_SHAPES["opencode-v2"].rootKeys);
    expect(openCodeContract("v2").httpType).toBe(MCP_SHAPES["opencode-v2"].remoteType);
  });
});

describe("every contract", () => {
  const all = (): Array<{ name: string; contract: JsonClientContract }> => [
    { name: "claude-code", contract: claudeCodeContract() },
    { name: "cursor", contract: cursorContract() },
    { name: "vscode", contract: vsCodeContract() },
    { name: "opencode-v1", contract: openCodeContract("v1") },
    { name: "opencode-v2", contract: openCodeContract("v2") },
  ];

  it("resolves an absolute config path on every platform", () => {
    for (const platform of PLATFORMS) {
      withPlatform(platform, () => {
        if (platform === "win32") process.env.APPDATA = path.join(os.homedir(), "AppData");
        for (const { name, contract } of all()) {
          expect(path.isAbsolute(contract.current.file), name).toBe(true);
        }
      });
    }
  });

  it("never lists its live layout as stale", () => {
    // A contract that did would make `install` report the entry it just wrote.
    for (const { name, contract } of all()) {
      const live = JSON.stringify(contract.current);
      expect(contract.stale.map((layout) => JSON.stringify(layout)), name).not.toContain(live);
    }
  });

  it("names at least one root key", () => {
    for (const { name, contract } of all()) {
      expect(contract.current.rootKeys.length, name).toBeGreaterThan(0);
    }
  });
});
