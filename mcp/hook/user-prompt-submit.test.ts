import { describe, expect, it } from "vitest";

import { readEvents } from "./state";
import { hookContext } from "./test-context";
import { userPromptSubmit } from "./user-prompt-submit";

const optedOut = async (prompt: string) => {
  const ctx = hookContext({ input: { session_id: "s1", prompt } });
  expect(await userPromptSubmit(ctx)).toBeNull();
  return readEvents(ctx.config.dataDir, "s1").some((e) => e.t === "optout");
};

describe("UserPromptSubmit: the way out for one session", () => {
  it("takes no-handoff or todox off anywhere in the message, any case", async () => {
    expect(await optedOut("quick fix, no-handoff please")).toBe(true);
    expect(await optedOut("Todox OFF for this one")).toBe(true);
  });

  it("does not read ordinary prompts as an opt-out", async () => {
    expect(await optedOut("write the handoff and turn todox on")).toBe(false);
    expect(await optedOut("is there no handoff yet?")).toBe(false);
  });
});
