import { describe, expect, it } from "vitest";

import { MCP_MEMORY_PATHS, type McpClientId } from "../lib/mcp-clients";
import { notesFor } from "./client-notes";

/**
 * These strings are read by a model deciding what to do next, and they are the
 * only place it learns where the habit goes. They were wrong for four of the
 * five clients -- each naming a project-level file, which an agent would
 * dutifully write and which would then apply to that one repository. Nothing
 * failed; todox was simply absent in the next checkout, exactly as if it had
 * never been installed.
 */
const FAMILIES: McpClientId[] = ["claude-code", "codex", "cursor", "vscode", "opencode"];

describe("what the briefing tells an agent about its memory file", () => {
  it("names a user-level path for every client", () => {
    for (const family of FAMILIES) {
      const said = notesFor(family).join(" ");
      expect(said, family).toContain("~/");
    }
  });

  it("never sends an agent to a file that applies to one repository", () => {
    // Each of these was in the advice at some point, and each is read only
    // inside the checkout that contains it.
    const projectScoped = [".cursorrules", ".github/copilot-instructions.md"];
    for (const family of FAMILIES) {
      const instruction = notesFor(family)[0]!;
      for (const wrong of projectScoped) expect(instruction, family).not.toContain(wrong);
      // A bare `AGENTS.md` is the same trap: it is the repository's file unless
      // a directory is named in front of it.
      expect(instruction, family).not.toMatch(/(^|[\s`])AGENTS\.md/);
    }
  });

  it("tells even an unrecognised client which kind of file to look for", () => {
    // No path to give, so the distinction has to be carried in words.
    const said = notesFor("unknown").join(" ");
    expect(said).toMatch(/every project|not the one inside/i);
  });

  it("points at the same file the installer writes", () => {
    // Two surfaces, one table. When they disagreed, the agent was told one
    // thing and `--write-memory` did another.
    for (const family of FAMILIES) {
      const target = MCP_MEMORY_PATHS[family];
      expect(notesFor(family)[0], family).toContain(target.location.darwin);
    }
  });

  it("keeps every memory path platform-independent", () => {
    // The server answers an agent whose operating system it cannot know, so
    // the note quotes one platform's path. That is only honest while the three
    // agree; the day one differs, this fails instead of the note going quietly
    // wrong on two platforms out of three.
    for (const family of FAMILIES) {
      const { darwin, linux, win32 } = MCP_MEMORY_PATHS[family].location;
      expect([linux, win32], family).toEqual([darwin, darwin]);
    }
  });
});
