import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fileLogger } from "./log";

describe("the hook log", () => {
  it("writes one line per event, whitespace folded", () => {
    const dir = mkdtempSync(join(tmpdir(), "todox-hook-log-"));
    fileLogger(dir)("stop", "two\nlines");
    expect(readFileSync(join(dir, "hook.log"), "utf8")).toMatch(/^\S+ stop two lines\n$/);
  });

  it("rotates instead of growing", () => {
    const dir = mkdtempSync(join(tmpdir(), "todox-hook-log-"));
    writeFileSync(join(dir, "hook.log"), "x".repeat(64 * 1024));
    fileLogger(dir)("stop", "after");
    expect(existsSync(join(dir, "hook.log.1"))).toBe(true);
    expect(readFileSync(join(dir, "hook.log"), "utf8")).toMatch(/stop after\n$/);
  });
});
