import { describe, expect, it } from "vitest";

import { HEAD_CHARS } from "../repositories/entries";
import { headlineHint, quickCloseHint } from "./write-hints";

/**
 * Advice, never a refusal: both rules answer a measured habit (half of all
 * handoffs open with a line the briefing cuts; a quarter of finished tasks
 * lived under fifteen minutes) and both must stay quiet on the ordinary case,
 * or they become the sentence an agent learns to skip.
 */
describe("headlineHint", () => {
  it("is quiet for a headline the briefing shows whole", () => {
    expect(headlineHint("Chose scrypt over bcrypt\n\nwhy...")).toBeUndefined();
    expect(headlineHint("x".repeat(HEAD_CHARS))).toBeUndefined();
  });

  it("speaks when the first line runs past what the briefing shows", () => {
    const hint = headlineHint(`${"x".repeat(HEAD_CHARS + 60)}\nmore`);
    expect(hint).toContain(String(HEAD_CHARS + 60));
    expect(hint).toContain(String(HEAD_CHARS));
  });

  it("judges the first line, not the body", () => {
    expect(headlineHint(`short head\n${"y".repeat(5000)}`)).toBeUndefined();
  });
});

describe("quickCloseHint", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 16, 10, minutes)).toISOString();

  it("speaks for a task done within minutes of being filed", () => {
    expect(quickCloseHint({ status: "done", created_at: at(0), closed_at: at(4) })).toContain(
      "log_entry",
    );
  });

  it("is quiet once the task lived a quarter of an hour", () => {
    expect(quickCloseHint({ status: "done", created_at: at(0), closed_at: at(15) })).toBeUndefined();
  });

  it("is quiet for anything but done", () => {
    expect(quickCloseHint({ status: "dropped", created_at: at(0), closed_at: at(1) })).toBeUndefined();
    expect(quickCloseHint({ status: "doing", created_at: at(0), closed_at: null })).toBeUndefined();
  });
});
