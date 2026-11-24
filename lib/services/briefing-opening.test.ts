import { describe, expect, it } from "vitest";
import type { Briefing } from "./briefing-digest";
import { hasMatchedNotes, OPENING_MAX_CHARS, renderOpening } from "./briefing-opening";

/**
 * What a session is shown before it has done anything. What these hold is that
 * it fits, that a matching note is whole or named and never cut, and that
 * whatever was left out is counted with a way to get it.
 */
const note = (id: number, over: object = {}) => ({
  id,
  kind: "gotcha",
  title: `Note ${id}`,
  body: `body of ${id}`,
  matched: true,
  created_at: "2026-11-20T00:00:00Z",
  updated_at: "2026-11-24T00:00:00Z",
  ...over,
});
const task = (id: number, status: string, over: object = {}) => ({
  id,
  title: `Task ${id}`,
  status,
  last_handoff: null,
  decisions: [],
  dead_ends: [],
  open_questions: [],
  files: [],
  ...over,
});
const brief = (over: object = {}): Briefing =>
  ({
    project: { slug: "repo", name: "repo", root_path: "/repo", summary: "A repository." },
    developer: [],
    global_context: [],
    project_context: [],
    open_tasks: [],
    idle_tasks: [],
    open_tasks_omitted: 0,
    observations: [],
    ...over,
  }) as unknown as Briefing;
const notes = (from: number, count: number, over: object = {}) =>
  Array.from({ length: count }, (_, i) => note(from + i, over));

describe("hasMatchedNotes", () => {
  it("is about the focus, in either scope", () => {
    expect(hasMatchedNotes(brief({ project_context: [note(1, { matched: false })] }))).toBe(false);
    expect(hasMatchedNotes(brief({ project_context: [note(1, { matched: undefined })] }))).toBe(false);
    expect(hasMatchedNotes(brief({ global_context: [note(1)] }))).toBe(true);
  });
});

describe("renderOpening", () => {
  it("carries five matching notes whole, best first, and leaves the rest out", () => {
    const { text } = renderOpening(
      brief({ project_context: [...notes(1, 7), note(90, { matched: false, body: "unrelated" })] }),
      [],
    );
    for (const id of [1, 2, 3, 4, 5]) expect(text).toContain(`body of ${id}\n`);
    expect(text).not.toContain("body of 6");
    expect(text).not.toContain("unrelated");
    expect(text).toContain("Note 6 (note 6)");
    expect(text).toContain("Not shown: 3 notes");
  });

  it("keeps a seat for an account-wide rule", () => {
    const { text } = renderOpening(brief({ project_context: notes(1, 9), global_context: [note(50)] }), []);
    expect(text).toContain("body of 50");
    expect(text).not.toContain("body of 5\n");
  });

  it("names a note too long to send instead of cutting it, and still sends the one after it", () => {
    const { text } = renderOpening(
      brief({ project_context: [note(1, { body: "x".repeat(6_000) }), note(2)] }),
      [],
    );
    expect(text).not.toContain("xxx");
    expect(text).toContain("Note 1 (note 1)");
    expect(text).toContain("body of 2");
  });

  it("puts work in progress before the rest of the list", () => {
    const { text } = renderOpening(
      brief({ project_context: [note(1)], open_tasks: [task(1, "todo"), task(2, "doing")] }),
      [],
    );
    expect(text.indexOf("#2 [doing]")).toBeLessThan(text.indexOf("#1 [todo]"));
  });

  it("shows what failed before, unanswered questions, and work left without a handoff", () => {
    const { text } = renderOpening(
      brief({
        project_context: [note(1)],
        open_tasks: [task(3, "todo", { open_questions: [{ id: 9, head: "Which port?" }] })],
        observations: [
          { id: 4, observed_at: "2026-11-23T00:00:00Z", handoff_missing: [3] },
          { id: 5, observed_at: "2026-11-23T00:00:00Z", handoff_missing: [] },
        ],
      }),
      [{ entry_id: 12, task_id: 8, snippet: "tried a lock, it deadlocks" }],
    );
    expect(text).toContain("- #8 (entry 12): tried a lock, it deadlocks");
    expect(text).toContain("(entry 9): Which port?");
    expect(text).toContain("no handoff on #3 (observation 4)");
    expect(text).not.toContain("observation 5");
  });

  it("puts queued work first, as a request and not a record", () => {
    const { text } = renderOpening(
      brief({ project_context: [note(1)], requested: [{ id: 31, title: "Ship it", body: "today" }] }),
      [],
    );
    expect(text.indexOf("#31 Ship it")).toBeGreaterThan(0);
    expect(text.indexOf("#31 Ship it")).toBeLessThan(text.indexOf("Note 1"));
  });

  it("fits whatever the project holds, and says how to get the rest", () => {
    const long = "l".repeat(400);
    const { text, chars } = renderOpening(
      brief({
        requested: Array.from({ length: 10 }, (_, i) => ({ id: 500 + i, title: long, body: long })),
        developer: Array.from({ length: 5 }, (_, i) => ({ id: i, kind: "profile", title: long, body: long })),
        project_context: notes(1, 60, { title: long, body: "b".repeat(1_000) }),
        global_context: notes(100, 60, { title: long, body: "b".repeat(1_000) }),
        open_tasks: Array.from({ length: 50 }, (_, i) =>
          task(200 + i, i % 2 ? "doing" : "todo", { title: long, open_questions: [{ id: i, head: long }] }),
        ),
      }),
      Array.from({ length: 3 }, (_, i) => ({ entry_id: i, task_id: i, snippet: long })),
    );
    expect(chars).toBe(text.length);
    expect(chars).toBeLessThanOrEqual(OPENING_MAX_CHARS);
    expect(text.split("\n").at(-1)).toMatch(/^Not shown: \d+ notes, \d+ open tasks\..*shape:'full'/);
  });
});
