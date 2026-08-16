import {
  MCP_MEMORY_PATHS,
  MEMORY_FILE_NAME,
  type McpClientId,
} from "../lib/mcp-clients";
import type { ClientFamily } from "../lib/server/client-info";

/**
 * Client-specific guidance the agent hears inside `get_context`.
 *
 * Every agent is told to put the habit in a memory file at session start, and
 * the file is different on every client. Naming the right one in the briefing
 * is how an agent that has never seen this project before knows where.
 *
 * The paths come from `MCP_MEMORY_PATHS` rather than being written out here.
 * They used to be prose, and four of the five were wrong in the same direction:
 * they named the *project* file -- `.cursorrules`, `.github/copilot-
 * instructions.md`, a repository's `AGENTS.md` -- which is read only inside the
 * checkout that holds it. An agent following that advice to the letter installs
 * the habit into one repository and arrives at the next one without it, which
 * is the failure this note exists to prevent, and the same one `--scope user`
 * exists to prevent on the config side.
 */
function memoryLocation(client: McpClientId): string {
  const target = MCP_MEMORY_PATHS[client];
  // Every entry is currently the same on all three platforms, and
  // `client-notes.test.ts` holds it that way -- the server is answering an
  // agent whose operating system it has no way of knowing.
  const location = target.location.darwin;
  return target.kind === "directory" ? `${location}/${MEMORY_FILE_NAME}` : location;
}

/** The sentence every client gets, with its own file in it. */
function putTheSnippetIn(client: McpClientId): string {
  return (
    `Put the four-line 'todox MCP is installed here' snippet in ${memoryLocation(client)} ` +
    "so the briefing loads at every session start. That path is the user-level one, " +
    "which is the point: a habit written into a project file is absent in the next " +
    "repository, and this memory is meant to cross them. `pnpm install:mcp <client> " +
    "--write-memory` does it for you, and is idempotent."
  );
}

export function notesFor(family: ClientFamily): string[] {
  switch (family) {
    case "claude-code":
      return [
        putTheSnippetIn("claude-code"),
        "Claude Code also reads .mcp.json at the project level; if a teammate will clone this repo, leave a one-line note about todox there too.",
      ];
    case "codex":
      return [
        putTheSnippetIn("codex"),
        "Codex's TOML config does not accept arbitrary child env, so this token was reached over the HTTP transport -- the capture is from the `initialize` body, not the parent process.",
      ];
    case "cursor":
      return [
        putTheSnippetIn("cursor"),
        "That is Cursor's user-rules directory, one file per rule. `.cursorrules` is the older project-level file and is being retired; writing there reaches this repository only.",
        "Cursor's MCP transport is HTTP; the same `initialize` capture applies.",
      ];
    case "vscode":
      return [
        putTheSnippetIn("vscode"),
        "VS Code searches that directory recursively for user instructions. `.github/copilot-instructions.md` is the workspace equivalent and applies to one checkout only.",
        "VS Code's MCP transport is HTTP; the same `initialize` capture applies.",
      ];
    case "opencode":
      return [
        putTheSnippetIn("opencode"),
        "OpenCode launches the stdio server with TODOX_CLIENT_NAME=opencode in the env, so the capture is set at startup rather than from the `initialize` body.",
      ];
    case "unknown":
      return [
        "The MCP client that opened this session is not one of the recognised ones. Check its docs for the memory file it reads at session start -- the one that applies to every project, not the one inside this repository -- and put the four-line snippet there.",
      ];
  }
}
