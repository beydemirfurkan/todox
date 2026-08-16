import { describe, expect, it } from "vitest";

import { MEMORY_SNIPPET } from "../../lib/mcp-clients";
import { memoryBlock, planMemoryWrite } from "./memory";

/**
 * The file this plans an edit to is the user's, and usually one they wrote by
 * hand: standing instructions, personal conventions, things they rely on. So
 * the properties worth asserting are all about restraint -- what survives, what
 * is not duplicated, and what happens on the second run.
 *
 * `planMemoryWrite` is pure and the write is a thin wrapper over it, which is
 * why the tests are here and not against a temporary directory: every rule
 * below is decidable from the old contents and the new.
 */
const EXISTING = `# My rules

- Always run the tests before saying something works.
- Prefer small commits.
`;

describe("planning the memory write", () => {
  it("creates the file when there is none", () => {
    const plan = planMemoryWrite(null);
    expect(plan.status).toBe("created");
    expect(plan.contents).toContain(MEMORY_SNIPPET);
  });

  it("keeps what was already in the file", () => {
    // The whole risk of this feature in one assertion.
    const plan = planMemoryWrite(EXISTING);
    expect(plan.status).toBe("updated");
    expect(plan.contents).toContain("Always run the tests before saying something works.");
    expect(plan.contents).toContain("Prefer small commits.");
    expect(plan.contents).toContain(MEMORY_SNIPPET);
  });

  it("leaves a blank line between their text and ours", () => {
    // Markdown: a list that starts on the line after a list joins it.
    const plan = planMemoryWrite("# My rules\n- one\n");
    expect(plan.contents).toContain("- one\n\n<!-- todox:begin -->");
  });

  it("adds nothing the second time", () => {
    // The point of the whole marker scheme. Two installs, one block.
    const once = planMemoryWrite(EXISTING).contents;
    const twice = planMemoryWrite(once);
    expect(twice.status).toBe("unchanged");
    expect(twice.contents).toBe(once);
    expect(twice.contents.split("<!-- todox:begin -->")).toHaveLength(2);
  });

  it("replaces an older block instead of appending beside it", () => {
    // The wording will change. If a stale block survived, the file would hold
    // two sets of instructions and the agent would obey whichever it read
    // first -- which is the older one.
    const stale = `${EXISTING}\n<!-- todox:begin -->\ncall get_context sometimes, maybe\n<!-- todox:end -->\n`;
    const plan = planMemoryWrite(stale);
    expect(plan.status).toBe("updated");
    expect(plan.contents).not.toContain("call get_context sometimes, maybe");
    expect(plan.contents).toContain(MEMORY_SNIPPET);
    expect(plan.contents.split("<!-- todox:begin -->")).toHaveLength(2);
  });

  it("keeps text written after our block", () => {
    // Somebody will add their own notes below it, and an edit that eats them
    // is the reason people stop letting a tool near their config.
    const withTail = `${planMemoryWrite(EXISTING).contents}\n## Mine, after\n- keep me\n`;
    const plan = planMemoryWrite(withTail);
    expect(plan.contents).toContain("- keep me");
    expect(plan.contents).toContain("Always run the tests before saying something works.");
  });

  it("does not treat a half-written marker as a block", () => {
    // An interrupted write, or a hand-edit that deleted the closing line.
    // Appending is right here; replacing would need an end we cannot find, and
    // guessing where the block stops could eat the rest of the file.
    const broken = `${EXISTING}\n<!-- todox:begin -->\nleftovers\n`;
    const plan = planMemoryWrite(broken);
    expect(plan.contents).toContain("leftovers");
    expect(plan.contents).toContain(MEMORY_SNIPPET);
  });

  it("carries no token", () => {
    // The habit, not the credential. Memory files get committed.
    expect(memoryBlock()).not.toMatch(/todox_|Bearer|Authorization/i);
  });
});
