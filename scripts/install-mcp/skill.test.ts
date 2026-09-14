import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, promises as fs, rmSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { skillDocument } from "../../mcp/tools";
import { isCurrentSkill, planSkillWrite, readSkillFile, writeSkillFile } from "./skill";

const root = mkdtempSync(path.join(tmpdir(), "todox-skill-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/**
 * The file is wholly todox's, so the plan is a whole-file comparison and the
 * write is a whole-file replacement: no fence to find, nothing of the user's
 * to keep, and a second run after an upgrade brings the text forward.
 */
describe("planning the skill write", () => {
  it("creates when there is nothing, and writes the current document", () => {
    const plan = planSkillWrite(null);
    expect(plan.status).toBe("created");
    expect(plan.contents).toBe(skillDocument());
  });

  it("is unchanged when the file already says exactly this", () => {
    expect(planSkillWrite(skillDocument()).status).toBe("unchanged");
  });

  it("updates a file from an earlier todox, whole", () => {
    const older = skillDocument().replace("BEFORE YOU FINISH", "WHEN DONE");
    const plan = planSkillWrite(older);
    expect(plan.status).toBe("updated");
    expect(plan.contents).toBe(skillDocument());
  });
});

describe("writing it", () => {
  it("creates the skill directory and the file, then reports unchanged on a second run", async () => {
    const file = path.join(root, "skills", "todox", "SKILL.md");
    expect(await readSkillFile(file)).toBeNull();

    expect((await writeSkillFile(file)).status).toBe("created");
    expect(await fs.readFile(file, "utf8")).toBe(skillDocument());
    expect(isCurrentSkill(await fs.readFile(file, "utf8"))).toBe(true);

    expect((await writeSkillFile(file)).status).toBe("unchanged");
  });

  it("replaces an older file rather than appending to it", async () => {
    const file = path.join(root, "older", "todox", "SKILL.md");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "---\nname: todox\ndescription: old\n---\nold text\n");
    expect(isCurrentSkill(await fs.readFile(file, "utf8"))).toBe(false);

    expect((await writeSkillFile(file)).status).toBe("updated");
    const text = await fs.readFile(file, "utf8");
    expect(text).toBe(skillDocument());
    expect(text).not.toContain("old text");
  });
});
