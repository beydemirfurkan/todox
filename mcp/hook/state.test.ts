import { appendFileSync, existsSync, mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { appendEvent, pruneSessions, readEvents, sessionPath } from "./state";

const fresh = () => mkdtempSync(join(tmpdir(), "todox-hook-state-"));

describe("per-session state", () => {
  it("cannot be steered out of its directory by a session id", () => {
    const path = sessionPath("/data", "../../etc/passwd");
    expect(dirname(path)).toBe(join("/data", "sessions"));
    expect(basename(path)).toBe("______etc_passwd.jsonl");
  });

  it("reads back what was appended, in order", () => {
    const dir = fresh();
    appendEvent(dir, "s", { t: "start", at: "a" });
    appendEvent(dir, "s", { t: "task", at: "b", id: 7 });
    expect(readEvents(dir, "s")).toEqual([
      { t: "start", at: "a" },
      { t: "task", at: "b", id: 7 },
    ]);
  });

  it("skips a line torn by a process that died mid-write", () => {
    const dir = fresh();
    appendEvent(dir, "s", { t: "edit", at: "a" });
    appendFileSync(sessionPath(dir, "s"), '{"t":"ta');
    expect(readEvents(dir, "s")).toEqual([{ t: "edit", at: "a" }]);
  });

  it("is empty for a session it never saw", () => {
    expect(readEvents(fresh(), "nobody")).toEqual([]);
  });

  it("forgets sessions untouched for a week, and only those", () => {
    const dir = fresh();
    appendEvent(dir, "old", { t: "edit", at: "a" });
    appendEvent(dir, "new", { t: "edit", at: "a" });
    const eightDaysAgo = (Date.now() - 8 * 86_400_000) / 1000;
    utimesSync(sessionPath(dir, "old"), eightDaysAgo, eightDaysAgo);

    expect(pruneSessions(dir)).toBe(1);
    expect(existsSync(sessionPath(dir, "old"))).toBe(false);
    expect(existsSync(sessionPath(dir, "new"))).toBe(true);
  });
});
