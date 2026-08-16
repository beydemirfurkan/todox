import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { MEMORY_SNIPPET } from "../../lib/mcp-clients";
import {
  claudeCodeContract,
  codexConfigFile,
  cursorContract,
  memoryFileFor,
  openCodeContract,
  vsCodeContract,
} from "./clients/contract";

/**
 * The README is a copy-paste surface: the config a reader pastes by hand comes
 * from there, not from the installer. So the paths and root keys it prints are
 * part of the contract, and this is the test that keeps them equal to it.
 *
 * It exists because the two had already drifted. The README's per-agent table
 * gave VS Code `mcpServers.NAME` while the prose two lines above it said
 * `servers` and the installer wrote `servers` — one of the three had to be
 * wrong, and the wrong one was the table a reader is most likely to copy.
 */
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const README = readFileSync(path.join(repoRoot, "README.md"), "utf8");

/** The `~`-shortened form a document writes, from the absolute path we resolve. */
function tildeForm(absolute: string): string {
  return absolute.replace(os.homedir(), "~").split(path.sep).join("/");
}

/**
 * `process.platform` is a plain value property, so `vi.spyOn` cannot see it.
 * Restoring it is not optional: vitest reuses a worker across files.
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

describe("README documents what the installer writes", () => {
  it("prints each client's config path", () => {
    const paths = [
      claudeCodeContract().current.file,
      cursorContract().current.file,
      codexConfigFile(),
      openCodeContract("v2").current.file,
    ];
    for (const absolute of paths) {
      expect(README, absolute).toContain(tildeForm(absolute));
    }
  });

  it("prints the VS Code path the installer resolves on darwin and on linux", () => {
    // Derived, not typed out: if the installer's darwin branch is ever removed,
    // `vsCodeContract()` starts producing the Linux path here and this fails,
    // rather than the README quietly documenting something nothing writes.
    for (const platform of ["darwin", "linux"] as const) {
      const file = withPlatform(platform, () => vsCodeContract().current.file);
      expect(README, `${platform}: ${file}`).toContain(tildeForm(file));
    }
  });

  it("prints VS Code's macOS path specifically, since it is the one that surprises", () => {
    expect(README).toContain("~/Library/Application Support/Code/User/mcp.json");
  });

  it("prints VS Code's Windows path", () => {
    expect(README).toContain("%APPDATA%\\Code\\User\\mcp.json");
  });

  it("gives VS Code the `servers` root key in the per-agent table", () => {
    expect(README).toMatch(/\|\s*VS Code[^|]*\|\s*`servers\.NAME`\s*\|/);
  });

  it("no longer claims `mcpServers` for VS Code anywhere in that table", () => {
    // The exact row that was wrong.
    expect(README).not.toMatch(/\|\s*VS Code[^|]*\|\s*`mcpServers\.NAME`\s*\|/);
  });

  it("gives both OpenCode majors their own row, with `remote` as the type", () => {
    expect(README).toMatch(/\|\s*OpenCode v1\s*\|\s*`mcp\.NAME`\s*\|\s*`"remote"`\s*\|/);
    expect(README).toMatch(
      /\|\s*OpenCode v2\s*\|\s*`mcp\.servers\.NAME`\s*\|\s*`"remote"`\s*\|/,
    );
  });
});

/**
 * The habit is a copy-paste surface too, and a longer-lived one than the config:
 * a reader pastes it into a file they keep for years. Three places already held
 * their own wording of it -- this README, the Account page, and the project's
 * own AGENTS.md -- which is how the config shapes drifted before
 * `lib/mcp-clients.ts` existed.
 */
describe("README prints the habit the installer writes", () => {
  it("quotes the snippet exactly, not a paraphrase of it", () => {
    expect(README).toContain(MEMORY_SNIPPET);
  });

  it("prints the user-level memory file for every client", () => {
    for (const client of ["claude-code", "codex", "cursor", "vscode", "opencode"] as const) {
      const file = memoryFileFor(client);
      expect(README, `${client}: ${file}`).toContain(tildeForm(file));
    }
  });

  it("documents the flag that writes it", () => {
    expect(README).toContain("--write-memory");
  });

  it("does not offer a project-level file as the place for it", () => {
    // `.cursorrules` and `.github/copilot-instructions.md` reach one checkout.
    // A README that names them beside the habit sends a reader to install a
    // cross-project memory into a single project.
    const habitSection = README.slice(README.indexOf(MEMORY_SNIPPET) - 1200);
    for (const wrong of [".cursorrules", ".github/copilot-instructions.md"]) {
      expect(habitSection, wrong).not.toContain(wrong);
    }
  });
});
