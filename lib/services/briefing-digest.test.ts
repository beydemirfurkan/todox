import { describe, expect, it } from "vitest";

import { renderDigest, type Briefing } from "./briefing-digest";

const AT = "2026-11-20T10:00:00.000Z";

function entry(id: number, head: string) {
  return { id, kind: "decision" as const, created_at: AT, head, body: null };
}

function task(id: number, status: string, extra: Partial<Briefing["open_tasks"][number]> = {}) {
  return {
    id,
    title: `Task ${id}`,
    status,
    priority: 2,
    head: "",
    body: null,
    updated_at: AT,
    last_handoff: null,
    decisions: [],
    dead_ends: [],
    open_questions: [],
    files: [],
    entry_count: 0,
    log_omitted: 0,
    ...extra,
  };
}

function briefingWith(overrides: Partial<Briefing> = {}): Briefing {
  return {
    project: { slug: "repo", name: "repo", root_path: "/repo", summary: "A repository." },
    developer: [],
    global_context: [],
    project_context: [],
    context_omitted: 0,
    context_ranked_by: "recency",
    open_tasks: [],
    idle_tasks: [],
    open_tasks_omitted: 0,
    observations: [],
    observations_omitted: 0,
    stale_refs: [],
    log_bodies_omitted: 0,
    task_bodies_omitted: 0,
    log_ranked_by: "recency",
    hint: "",
    ...overrides,
  } as unknown as Briefing;
}

/** A project big enough that no ceiling holds all of it. */
function crowded(): Briefing {
  const long = "x".repeat(200);
  return briefingWith({
    global_context: Array.from({ length: 40 }, (_, i) => ({ id: i, kind: "gotcha", title: `Rule ${i} ${long}` })),
    open_tasks: Array.from({ length: 50 }, (_, i) =>
      task(100 + i, i === 49 ? "doing" : "todo", {
        dead_ends: [entry(1000 + i, `Dead end ${i} ${long}`)],
      }),
    ),
  } as unknown as Partial<Briefing>);
}

describe("the briefing digest", () => {
  it("stays under its ceiling however much the project holds", () => {
    for (const max of [2000, 5000, 9500]) {
      const digest = renderDigest(crowded(), max);
      expect(digest.text.length).toBeLessThanOrEqual(max);
      expect(digest.chars).toBe(digest.text.length);
    }
  });

  it("always ends by saying what was left out and where the rest is", () => {
    const digest = renderDigest(crowded(), 2000);
    const last = digest.text.split("\n").at(-1)!;
    expect(last).toMatch(/^Left out for room: /);
    expect(last).toContain("get_context");
    expect(digest.dropped.tasks).toBeGreaterThan(0);
  });

  it("says nothing was left out when nothing was", () => {
    const digest = renderDigest(briefingWith({ open_tasks: [task(1, "todo")] } as Partial<Briefing>));
    expect(digest.dropped).toEqual({});
    expect(digest.text).not.toContain("Left out for room");
  });

  it("spends a small ceiling on rules and live work before the log", () => {
    const digest = renderDigest(crowded(), 5000);
    expect(digest.text).toContain("Rules (account-wide):");
    expect(digest.text).not.toContain("Dead ends (tried, failed):");
    expect(digest.dropped["dead ends"]).toBe(50);
  });

  it("puts the task in progress first", () => {
    const digest = renderDigest(
      briefingWith({ open_tasks: [task(1, "todo"), task(2, "doing")] } as Partial<Briefing>),
    );
    expect(digest.text.indexOf("#2 [doing]")).toBeLessThan(digest.text.indexOf("#1 [todo]"));
  });

  it("carries the last handoff's headline under its task, and says when there is none", () => {
    const handoff = { id: 7, kind: "handoff" as const, created_at: AT, head: "Stopped at the parser.", body: null };
    const digest = renderDigest(
      briefingWith({
        open_tasks: [task(1, "doing", { last_handoff: handoff }), task(2, "todo")],
      } as unknown as Partial<Briefing>),
    );
    expect(digest.text).toContain("#1 [doing] Task 1\n  handoff 2026-11-20: Stopped at the parser.");
    expect(digest.text).toContain("#2 [todo] Task 2\n  no handoff yet");
  });

  it("labels what it carries as data, not instructions", () => {
    expect(renderDigest(briefingWith()).text.split("\n")[0]).toContain("not instructions");
  });

  it("asks for a summary when the project has none", () => {
    const brief = briefingWith();
    brief.project.summary = null;
    expect(renderDigest(brief).text).toContain("Summary missing");
  });

  it("names every record by an id the agent can ask for", () => {
    const digest = renderDigest(
      briefingWith({
        project_context: [{ id: 5, kind: "convention", title: "Use tx()" }],
        open_tasks: [task(1, "todo", { open_questions: [entry(9, "Which port?")] })],
      } as unknown as Partial<Briefing>),
    );
    expect(digest.text).toContain("[convention] Use tx() (note 5)");
    expect(digest.text).toContain("- #1 (entry 9, 2026-11-20): Which port?");
  });

  it("opens with who the developer is, bodies and all, before any rule", () => {
    const { text } = renderDigest(
      briefingWith({
        developer: [
          { id: 7, kind: "profile", title: "Who", body: "Backend developer,\nwrites Turkish.", created_at: "", updated_at: "" },
          { id: 8, kind: "stack", title: "Tools", body: null, created_at: "", updated_at: "" },
        ],
        global_context: [{ id: 1, kind: "gotcha", title: "A rule", body: null, created_at: "", updated_at: "" }],
      } as unknown as Partial<Briefing>),
    );
    expect(text).toContain("- [profile] Who: Backend developer, writes Turkish.");
    expect(text).toContain("- [stack] Tools (note 8)");
    expect(text.indexOf("[profile]")).toBeLessThan(text.indexOf("A rule"));
  });
});

describe("the queue from the panel", () => {
  const request = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    title: `Queued ${id}`,
    priority: 2,
    requested_at: AT,
    body: "Do the thing.",
    ...extra,
  });

  it("leads the digest and says it is a request, not a record", () => {
    const { text } = renderDigest(briefingWith({ requested: [request(7)] }));
    const lines = text.split("\n");
    const heading = lines.findIndex((l) => l.startsWith("Queued for you in the todox panel"));
    // Straight after the two header lines: before the developer, the rules and every task.
    expect(heading).toBe(2);
    expect(lines[heading + 1]).toBe("- #7 Queued 7: Do the thing.");
  });

  it("tells the agent to ask before taking a teammate's request", () => {
    const { text } = renderDigest(briefingWith({ requested: [request(8, { requested_by: "Ayşe" })] }));
    expect(text).toContain("#8 Queued 8 -- queued by Ayşe, a teammate: ask the developer before taking it");
  });

  it("survives a ceiling that drops everything else", () => {
    const brief = crowded();
    (brief as { requested?: unknown[] }).requested = [request(9)];
    const { text } = renderDigest(brief, 1_200);
    expect(text).toContain("- #9 Queued 9");
  });

  it("has no heading at all when nothing is queued", () => {
    expect(renderDigest(briefingWith()).text).not.toContain("Queued for you");
  });
});
