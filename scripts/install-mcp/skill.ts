import { promises as fs } from "node:fs";
import * as path from "node:path";

import { skillDocument } from "../../mcp/tools";
import { writeTextFile } from "./clients/atomic-write";

/**
 * Writing the session protocol as a skill the client loads on its own.
 *
 * The memory file is four lines and always in front of the agent. The skill
 * is the whole protocol -- the text the server sends at `initialize` -- in a
 * file the client loads when its description matches the moment, so the
 * long version costs nothing until it is wanted. Same reason as the memory
 * file for why it is written at all: an MCP server's `instructions` lose to
 * what the client reads first, and a skill is something the client reads
 * first.
 *
 * Unlike the memory file this one is wholly todox's: it lives in a directory
 * named for the skill, holds nothing of the user's, and is replaced whole.
 * No fence, no merge, and a second run after an upgrade brings the text up to
 * date -- which is why the comment at its top says to re-run.
 */

export type SkillWrite = {
  /** What the file will contain. Returned so `--dry-run` can show it. */
  readonly contents: string;
  readonly status: "created" | "updated" | "unchanged";
};

/** Work out what the file should say, without touching it. */
export function planSkillWrite(existing: string | null): SkillWrite {
  const contents = skillDocument();
  if (existing === null) return { contents, status: "created" };
  return { contents, status: existing === contents ? "unchanged" : "updated" };
}

/** Read the file, or null when it is not there yet. */
export async function readSkillFile(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** Plan and write. The directory is created; the file is replaced whole. */
export async function writeSkillFile(file: string): Promise<SkillWrite> {
  const plan = planSkillWrite(await readSkillFile(file));
  if (plan.status === "unchanged") return plan;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeTextFile(file, plan.contents);
  return plan;
}

/**
 * Whether a skill file is the one this build would write. For the doctor: a
 * skill from an older todox still loads, but it teaches an older protocol.
 */
export function isCurrentSkill(text: string): boolean {
  return text === skillDocument();
}
