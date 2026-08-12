import type { ClientFamily } from "../lib/server/client-info";

/**
 * Client-specific guidance the agent hears inside `get_context`.
 *
 * Every agent is told to read a memory file at session start -- the four lines
 * in the README -- but the file is different on every client. Putting the
 * pointer to the right file in the briefing is the only way an agent that has
 * never seen this project before knows where to add it.
 */
export function notesFor(family: ClientFamily): string[] {
  switch (family) {
    case "claude-code":
      return [
        "Claude Code reads ~/.claude/CLAUDE.md. Put the four-line 'todox MCP is installed here' snippet there so the briefing loads at every session start.",
        "Claude Code also reads .mcp.json at the project level; if a teammate will clone this repo, leave a one-line note about todox there too.",
      ];
    case "codex":
      return [
        "Codex reads AGENTS.md. Put the four-line snippet there.",
        "Codex's TOML config does not accept arbitrary child env, so this token was reached over the HTTP transport -- the capture is from the `initialize` body, not the parent process.",
      ];
    case "cursor":
      return [
        "Cursor reads .cursorrules. Put the four-line snippet there.",
        "Cursor's MCP transport is HTTP; the same `initialize` capture applies.",
      ];
    case "vscode":
      return [
        "VS Code Copilot Chat reads .github/copilot-instructions.md. Put the four-line snippet there.",
        "VS Code's MCP transport is HTTP; the same `initialize` capture applies.",
      ];
    case "opencode":
      return [
        "OpenCode reads AGENTS.md. Put the four-line snippet there.",
        "OpenCode launches the stdio server with TODOX_CLIENT_NAME=opencode in the env, so the capture is set at startup rather than from the `initialize` body.",
      ];
    case "unknown":
      return [
        "The MCP client that opened this session is not one of the recognised ones. Check its docs for the memory file it reads at session start and put the four-line snippet there.",
      ];
  }
}
