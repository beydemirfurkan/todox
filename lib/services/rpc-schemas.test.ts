import { describe, expect, it } from "vitest";

import { parseParams } from "./rpc-schemas";
import type { MethodName } from "./rpc-schemas";

/**
 * Adding a field to a shape whose refinement lists the others by hand is a
 * two-step change, and the second step is easy to miss: `repo_url` was
 * accepted by the schema and then refused by the guard that asks for "at
 * least one of", which named its siblings and not it.
 */
describe("update refinements cover every field they gate", () => {
  it("updateProject accepts each of its fields on its own", () => {
    for (const field of ["name", "root_path", "repo_url", "summary"] as const)
      expect(() =>
        parseParams("updateProject", { project: "todox", [field]: "x" }),
      ).not.toThrow();
  });

  it("updateTask accepts each of its fields on its own", () => {
    expect(() => parseParams("updateTask", { task_id: 1, title: "x" })).not.toThrow();
    expect(() => parseParams("updateTask", { task_id: 1, body: "x" })).not.toThrow();
    expect(() => parseParams("updateTask", { task_id: 1, status: "done" })).not.toThrow();
    expect(() => parseParams("updateTask", { task_id: 1, priority: 1 })).not.toThrow();
  });

  it("still refuses a patch of nothing", () => {
    expect(() => parseParams("updateProject", { project: "todox" })).toThrow();
    expect(() => parseParams("updateTask", { task_id: 1 })).toThrow();
  });
});

/**
 * The second layer of the injection fix. The repositories allow-list their
 * columns, but nothing should reach them unvalidated in the first place: the
 * route used to cast `payload.params` and hand it straight to a handler.
 */
describe("parseParams", () => {
  it("rejects the injected key outright", () => {
    expect(() =>
      parseParams("updateTask", {
        task_id: 1,
        "title = (SELECT password_hash FROM users WHERE id=1), body": "x",
      }),
    ).toThrow(/invalid params/);
  });

  it("rejects any unrecognised key rather than ignoring it", () => {
    expect(() => parseParams("updateTask", { task_id: 1, colour: "red" })).toThrow(
      /invalid params/,
    );
  });

  it("rejects a patch that would write nothing", () => {
    // This used to return the unchanged row, which reads to an agent exactly
    // like a successful write.
    expect(() => parseParams("updateTask", { task_id: 1 })).toThrow(/at least one/);
    expect(() => parseParams("updateTask", { task_id: 1, model: "opus" })).toThrow(
      /at least one/,
    );
  });

  it("lets a real update through", () => {
    expect(parseParams("updateTask", { task_id: 1, status: "done", model: "opus" })).toEqual(
      { task_id: 1, status: "done", model: "opus" },
    );
  });

  it("rejects a status outside the vocabulary", () => {
    expect(() => parseParams("updateTask", { task_id: 1, status: "finished" })).toThrow();
  });

  it("refuses a date it cannot parse instead of throwing RangeError later", () => {
    // `activity_report({from: "last monday"})` is a natural thing for a model
    // to emit; it used to surface as an unhelpful "Invalid time value".
    expect(() => parseParams("activityReport", { from: "last monday" })).toThrow(
      /invalid params/,
    );
    expect(parseParams("activityReport", { from: "2026-08-09T00:00:00Z" })).toEqual({
      from: "2026-08-09T00:00:00Z",
    });
  });

  it("clamps search limits", () => {
    expect(() => parseParams("search", { query: "x", limit: -1 })).toThrow();
    expect(() => parseParams("search", { query: "x", limit: 1_000_000 })).toThrow();
  });

  it("refuses an empty link_files call that would look like success", () => {
    expect(() => parseParams("linkFiles", { task_id: 1, paths: [] })).toThrow();
  });

  it("rejects an unknown method", () => {
    // @ts-expect-error -- the point is the runtime guard, not the type
    expect(() => parseParams("dropEverything", {})).toThrow();
  });
});

/**
 * Behaviour, not presence: `parseParams` runs both the SHAPES layer and the
 * per-method `.strict()` wrapper in lib/services/rpc-schemas.ts, so an
 * `expect("model" in SHAPES.x])` test would silently pass even if a future
 * regression tightened `.strict()` and the method kept the field. Parsing
 * with `model` in the input exercises both layers in one call.
 */
describe("model field round-trips through parseParams on every method", () => {
  // Minimal payload per method -- enough to satisfy required fields without
  // pulling in fakes for ref shapes.
  const fixtures: Record<string, Record<string, unknown>> = {
    listProjects: {},
    listTasks: { project: "x" },
    getContext: { cwd: "/tmp" },
    getTask: { task_id: 1 },
    createProject: { name: "x" },
    updateProject: { project: "x", summary: "y" },
    deleteProject: { project: "x", confirm: "x" },
    createTask: { title: "x" },
    updateTask: { task_id: 1, status: "doing" },
    logEntry: { task_id: 1, kind: "note", body: "x" },
    linkFiles: { task_id: 1, paths: [{ path: "/tmp/x" }] },
    reportRefs: { refs: [{ id: 1, hash: "a".repeat(64) }] },
    addContext: { kind: "convention", title: "x", body: "x" },
    search: { query: "x" },
    activityReport: { period: "today" },
  };

  for (const [method, base] of Object.entries(fixtures) as [MethodName, Record<string, unknown>][]) {
    it(`${method} accepts { ...base, model: "test" }`, () => {
      const out = parseParams(method, { ...base, model: "test-model" });
      expect(out.model).toBe("test-model");
    });

    it(`${method} still rejects an unknown key`, () => {
      // The shape gained a field; .strict() must not have been relaxed.
      expect(() => parseParams(method, { ...base, bogus_key: 1 })).toThrow();
    });
  }
});
