import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { PersonaKey } from "./personas";

/** Outside the repository on purpose: the personas' repos are git repos too. */
export const LAB = process.env.TODOX_LAB_DIR ?? join(homedir(), "todox-lab");
export const SECRETS = join(LAB, ".secrets");
export const RUNS = join(LAB, "runs");

/** The checkout this script runs from: the stdio server the agents start. */
export const TODOX_ROOT = resolve(import.meta.dirname, "..", "..");
export const TSX = join(TODOX_ROOT, "node_modules", ".bin", "tsx");
export const MCP_SERVER = join(TODOX_ROOT, "mcp", "server.ts");

export const LAB_URL = process.env.TODOX_URL ?? "http://localhost:3123";

export const repoDir = (persona: PersonaKey, project: string) => join(LAB, persona, project);
export const secretsDir = (persona: PersonaKey) => join(SECRETS, persona);
export const tokenFile = (persona: PersonaKey) => join(secretsDir(persona), "token");
export const claudeConfig = (persona: PersonaKey) => join(secretsDir(persona), "claude-mcp.json");
/** OpenCode reads `$XDG_CONFIG_HOME/opencode/opencode.json`; this is that home. */
export const openCodeHome = (persona: PersonaKey) => join(secretsDir(persona), "xdg");

/** A lab persona's password: the reviewers sign in with it to look at the web app. */
export const passwordFor = (persona: PersonaKey) => `lab-${persona}-password`;

/** Which models the agents run. OpenCode runs Anthropic models: OpenAI auth
 *  in this OpenCode install answers 400 to headless runs (2026-11-22). */
export const CLAUDE_MODEL = process.env.TODOX_LAB_CLAUDE_MODEL ?? "sonnet";
export const OPENCODE_MODELS: Record<PersonaKey, string> = {
  elif: "anthropic/claude-sonnet-5-5",
  mert: "anthropic/claude-sonnet-5-5",
  ayse: "anthropic/claude-sonnet-5-5",
  // The junior gets the small model: does a weaker model still follow the
  // server's instructions, or only a strong one?
  can: "anthropic/claude-haiku-5-5",
  jonas: "anthropic/claude-sonnet-5-5",
};
