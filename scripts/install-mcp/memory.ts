import { promises as fs } from "node:fs";

import { MEMORY_SNIPPET } from "../../lib/mcp-clients";
import { writeTextFile } from "./clients/atomic-write";

/**
 * Writing the habit into the memory file the agent actually obeys.
 *
 * Registering the server makes the tools exist. Whether an agent *reaches* for
 * them at the start of a session is decided somewhere else entirely: an MCP
 * server's `instructions` lose to a rule in the file the client reads first.
 * Installing one without the other is how a connected todox goes two sessions
 * without being called.
 *
 * This edits a file that is the user's, and often one they have written by
 * hand, so it behaves like a guest: its own fenced block, never a rewrite of
 * anything around it, and nothing at all unless it was asked.
 */

/**
 * The fence. Everything between the markers belongs to todox and may be
 * replaced; everything outside them is the user's and is copied through
 * untouched.
 *
 * Matching on a marker rather than on the snippet text is what makes a second
 * run replace instead of append. Searching for the prose would stop matching
 * the moment the wording changed, and the next install would leave two copies
 * of nearly the same paragraph -- with the older one still being obeyed.
 */
const BEGIN = "<!-- todox:begin -->";
const END = "<!-- todox:end -->";

/** The block as it lands in the file, markers included. */
export function memoryBlock(): string {
  return `${BEGIN}\n${MEMORY_SNIPPET}\n${END}`;
}

export type MemoryWrite = {
  /** What the file will contain. Returned so `--dry-run` can show it. */
  readonly contents: string;
  readonly status: "created" | "updated" | "unchanged";
};

/**
 * Work out what the file should say, without touching it.
 *
 * Split from the write so the dry run and the real run answer from the same
 * code. A dry run that describes a different edit than the one that follows is
 * worse than no dry run.
 */
export function planMemoryWrite(existing: string | null): MemoryWrite {
  const block = memoryBlock();
  if (existing === null) return { contents: `${block}\n`, status: "created" };

  const begin = existing.indexOf(BEGIN);
  const end = existing.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) {
    // No block of ours yet. Append, and keep one blank line between whatever
    // was there and what we add -- the file is Markdown and a heading that
    // runs straight into a list reads as one item.
    const separator = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
    return { contents: `${existing}${separator}${block}\n`, status: "updated" };
  }

  const before = existing.slice(0, begin);
  const after = existing.slice(end + END.length);
  const contents = `${before}${block}${after}`;
  return { contents, status: contents === existing ? "unchanged" : "updated" };
}

/** Read the file, or null when it is not there yet. */
export async function readMemoryFile(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Put the block in the file. `writeTextFile` creates the directory and does the
 * write-then-rename, which is what Cursor and VS Code need: their instructions
 * directory may not exist until something makes one.
 */
export async function writeMemoryFile(file: string): Promise<MemoryWrite> {
  const plan = planMemoryWrite(await readMemoryFile(file));
  if (plan.status !== "unchanged") await writeTextFile(file, plan.contents);
  return plan;
}
