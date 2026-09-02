import { describe, expect, it } from "vitest";

import { parseParams, SHAPES } from "./rpc-schemas";
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

  it("updateContext accepts each of its fields on its own", () => {
    expect(() => parseParams("updateContext", { context_id: 1, kind: "gotcha" })).not.toThrow();
    expect(() => parseParams("updateContext", { context_id: 1, title: "x" })).not.toThrow();
    expect(() => parseParams("updateContext", { context_id: 1, body: "x" })).not.toThrow();
  });

  it("still refuses a patch of nothing", () => {
    expect(() => parseParams("updateProject", { project: "todox" })).toThrow();
    expect(() => parseParams("updateTask", { task_id: 1 })).toThrow();
    expect(() => parseParams("updateContext", { context_id: 1 })).toThrow(/at least one/);
    // `model` is on every shape and patches nothing, so it must not satisfy
    // the refinement on its own.
    expect(() => parseParams("updateContext", { context_id: 1, model: "opus" })).toThrow(
      /at least one/,
    );
  });
});

/**
 * The methods that act on something an earlier session wrote.
 *
 * Each takes an id and nothing else, which makes the id the entire request --
 * so what is asserted here is that nothing *but* an id gets through. A string
 * id in particular: `"1 OR 1=1"` is the shape a caller reaches for, and these
 * are the calls where a coerced one would remove a row or silence a warning
 * on somebody else's.
 */
/**
 * Every method whose whole shape is one id.
 *
 * Mostly corrections, and `getContextNote` besides -- a read, but the same
 * shape and the same exposure: an integer straight off the wire, handed to a
 * repository function that takes no user id and is guarded only by the
 * `assert*` call above it.
 */
describe("the methods that take nothing but an id", () => {
  const ID_ONLY = [
    ["deleteContext", "context_id"],
    ["deleteEntry", "entry_id"],
    ["unlinkRef", "ref_id"],
    ["acceptRef", "ref_id"],
    ["getContextNote", "context_id"],
  ] as const;

  for (const [method, field] of ID_ONLY) {
    it(`${method} accepts an integer id`, () => {
      expect(() => parseParams(method, { [field]: 7 })).not.toThrow();
    });

    it(`${method} refuses an id that is not a number`, () => {
      expect(() => parseParams(method, { [field]: "7 OR 1=1" })).toThrow(/invalid params/);
      expect(() => parseParams(method, { [field]: "7" })).toThrow(/invalid params/);
    });

    it(`${method} refuses a fractional id`, () => {
      expect(() => parseParams(method, { [field]: 1.5 })).toThrow(/invalid params/);
    });

    it(`${method} refuses a missing id`, () => {
      expect(() => parseParams(method, {})).toThrow(/invalid params/);
    });

    it(`${method} refuses anything alongside the id`, () => {
      // `strict()` everywhere, but these are the shapes where a stray key
      // would be a caller aiming at a column.
      expect(() => parseParams(method, { [field]: 7, user_id: 2 })).toThrow(
        /invalid params/,
      );
    });
  }
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
    mergeProjects: { from: "x", into: "y", confirm: "x" },
    createTask: { title: "x" },
    updateTask: { task_id: 1, status: "doing" },
    logEntry: { task_id: 1, kind: "note", body: "x" },
    deleteEntry: { entry_id: 1 },
    linkFiles: { task_id: 1, paths: [{ path: "/tmp/x" }] },
    reportRefs: { refs: [{ id: 1, hash: "a".repeat(64) }] },
    unlinkRef: { ref_id: 1 },
    acceptRef: { ref_id: 1 },
    addContext: { kind: "convention", title: "x", body: "x" },
    updateContext: { context_id: 1, body: "x" },
    deleteContext: { context_id: 1 },
    getContextNote: { context_id: 1 },
    getFileContext: { path: "lib/auth.ts", cwd: "/repo" },
    search: { query: "x" },
    activityReport: { period: "today" },
    recordClientInfo: { name: "claude-code" },
    recordObservation: { cwd: "/repo", session_id: "s", commits: 0, files_changed: 0 },
  };

  /**
   * The map above is hand-written, so a new method is untested by omission
   * rather than by failure -- the loop simply never reaches it. This is the
   * assertion that turns that silence into a red test.
   */
  it("covers every method in SHAPES", () => {
    expect(Object.keys(fixtures).sort()).toEqual(Object.keys(SHAPES).sort());
  });

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

/**
 * The remote is what identifies a repository on a machine other than the one it
 * was registered from, so it has to survive validation on the two methods that
 * resolve a project from a path.
 */
describe("repo_url reaches the resolver", () => {
  it("is accepted beside a cwd", () => {
    expect(
      parseParams("getContext", { cwd: "/tmp", repo_url: "git@github.com:me/repo.git" }).repo_url,
    ).toBe("git@github.com:me/repo.git");
    expect(
      parseParams("createTask", { title: "x", repo_url: "https://github.com/me/repo" }).repo_url,
    ).toBe("https://github.com/me/repo");
  });
});

describe("linkFiles takes one end or the other", () => {
  const paths = [{ path: "/repo/lib/auth.ts" }];

  it("accepts a task", () => {
    expect(() => parseParams("linkFiles", { task_id: 1, paths })).not.toThrow();
  });

  it("accepts a context note", () => {
    expect(() => parseParams("linkFiles", { context_id: 1, paths })).not.toThrow();
  });

  it("refuses both, because no unique index would de-duplicate such a row", () => {
    expect(() => parseParams("linkFiles", { task_id: 1, context_id: 1, paths })).toThrow(
      /exactly one/,
    );
  });

  it("refuses neither, rather than writing an orphan", () => {
    expect(() => parseParams("linkFiles", { paths })).toThrow(/exactly one/);
  });
});

describe("getFileContext", () => {
  it("needs a project or a cwd to fold the path against", () => {
    // Without one there is no set of roots, so an absolute path could not be
    // reduced to the name it shares with the same file on another machine.
    expect(() => parseParams("getFileContext", { path: "lib/auth.ts" })).toThrow(
      /either `project` or `cwd`/,
    );
  });

  it("takes a relative path as readily as an absolute one", () => {
    for (const path of ["lib/auth.ts", "/repo/lib/auth.ts", "C:/work/repo/lib/auth.ts"])
      expect(() => parseParams("getFileContext", { path, cwd: "/repo" })).not.toThrow();
  });

  it("refuses an empty path instead of matching everything", () => {
    expect(() => parseParams("getFileContext", { path: "", cwd: "/repo" })).toThrow(
      /invalid params/,
    );
  });
});

describe("mergeProjects", () => {
  /** It deletes a project. Every field is load-bearing. */
  it("rejects a call missing any of the three", () => {
    expect(() => parseParams("mergeProjects", { from: "a", into: "b" })).toThrow();
    expect(() => parseParams("mergeProjects", { from: "a", confirm: "a" })).toThrow();
    expect(() => parseParams("mergeProjects", { into: "b", confirm: "a" })).toThrow();
  });

  it("rejects a confirmation that is not a string", () => {
    expect(() => parseParams("mergeProjects", { from: "a", into: "b", confirm: true })).toThrow();
  });
});

/**
 * The briefing's relevance signal.
 *
 * It only ever reorders, so a bad value cannot produce a wrong answer — which
 * is exactly why it needs a test: nothing downstream would notice if it stopped
 * being accepted, and the tool would go on quietly ranking by recency.
 */
describe("getContext focus", () => {
  it("takes a sentence", () => {
    expect(() =>
      parseParams("getContext", { cwd: "/repo", focus: "fix the login redirect loop" }),
    ).not.toThrow();
  });

  it("is optional, because a session may not know yet", () => {
    expect(() => parseParams("getContext", { cwd: "/repo" })).not.toThrow();
  });

  it("refuses a whole essay, and anything that is not a string", () => {
    expect(() => parseParams("getContext", { cwd: "/repo", focus: "x".repeat(5000) })).toThrow(
      /invalid params/,
    );
    expect(() => parseParams("getContext", { cwd: "/repo", focus: ["a", "b"] })).toThrow(
      /invalid params/,
    );
  });

  it("still refuses an unknown key beside it", () => {
    expect(() => parseParams("getContext", { cwd: "/repo", focuss: "typo" })).toThrow(
      /invalid params/,
    );
  });
});

/**
 * The only way a question ever closes.
 *
 * Everything about this field is a rejection: the wrong type, the wrong task,
 * the wrong kind. The schema can only catch the first, and the other two live
 * in `task-service` because they need to read the row — but an id that is not
 * an integer must never reach that far, because what it reaches is a lookup.
 */
describe("logEntry answers_entry_id", () => {
  const base = { task_id: 1, kind: "decision", body: "settled it" };

  it("takes an integer id", () => {
    expect(() => parseParams("logEntry", { ...base, answers_entry_id: 118 })).not.toThrow();
  });

  it("is optional, because most entries answer nothing", () => {
    expect(() => parseParams("logEntry", base)).not.toThrow();
  });

  it("refuses anything that is not an integer", () => {
    expect(() => parseParams("logEntry", { ...base, answers_entry_id: "118 OR 1=1" })).toThrow(
      /invalid params/,
    );
    expect(() => parseParams("logEntry", { ...base, answers_entry_id: "118" })).toThrow(
      /invalid params/,
    );
    expect(() => parseParams("logEntry", { ...base, answers_entry_id: 1.5 })).toThrow(
      /invalid params/,
    );
  });
});

/**
 * The two ways to narrow a search.
 *
 * Both are optional and both are meant to be left out most of the time, which
 * is exactly why the schema has to be strict about them: a filter that is
 * quietly ignored searches everything and looks like it worked.
 */
describe("search filters", () => {
  it("takes a project ref and a list of kinds", () => {
    expect(() =>
      parseParams("search", { query: "scrypt", project: "todox", kinds: ["dead_end"] }),
    ).not.toThrow();
  });

  it("still works with neither, which is the common case", () => {
    expect(() => parseParams("search", { query: "scrypt" })).not.toThrow();
  });

  it("refuses a kind that is not one", () => {
    // The union spans entry kinds and note kinds; anything else would filter
    // every row out and read as "nothing recorded".
    expect(() => parseParams("search", { query: "x", kinds: ["dead-end"] })).toThrow(
      /invalid params/,
    );
    expect(() => parseParams("search", { query: "x", kinds: ["task"] })).toThrow(/invalid params/);
  });

  it("refuses an empty kinds list rather than treating it as no filter", () => {
    expect(() => parseParams("search", { query: "x", kinds: [] })).toThrow(/invalid params/);
  });

  it("takes kinds from both vocabularies", () => {
    // `gotcha` is a note kind and `handoff` is an entry kind; one list covers
    // both because the caller is asking about records, not about tables.
    expect(() =>
      parseParams("search", { query: "x", kinds: ["gotcha", "handoff", "decision"] }),
    ).not.toThrow();
  });
});

/**
 * The write path for automatic capture, and the one method here no agent ever
 * calls: the stdio process fires it for itself while a session runs. It is not
 * registered as a tool for the same reason `recordClientInfo` is not -- a
 * model asked to report what it just did would be reporting on itself, and the
 * point of an observation is that nobody had to be asked.
 */
describe("recordObservation", () => {
  const base = { cwd: "/repo", session_id: "s", commits: 0, files_changed: 0 };

  it("needs a project or a cwd, like every other path-resolved call", () => {
    expect(() => parseParams("recordObservation", { ...base, cwd: undefined })).toThrow();
    expect(() =>
      parseParams("recordObservation", { ...base, cwd: undefined, project: "todox" }),
    ).not.toThrow();
  });

  /**
   * A count is a count. Postgres would take a negative one happily and the
   * briefing would render "-3 commits", which reads as a bug in todox rather
   * than in whatever sent it.
   */
  it("refuses a negative count", () => {
    expect(() => parseParams("recordObservation", { ...base, commits: -1 })).toThrow();
    expect(() => parseParams("recordObservation", { ...base, files_changed: -1 })).toThrow();
  });

  it("refuses a fractional count", () => {
    expect(() => parseParams("recordObservation", { ...base, commits: 1.5 })).toThrow();
  });

  /**
   * The session id is the upsert's key. An empty one would collapse every
   * session in the project onto a single row, which is the opposite of the
   * bug it exists to prevent.
   */
  it("refuses an empty session id", () => {
    expect(() => parseParams("recordObservation", { ...base, session_id: "" })).toThrow();
  });
});

/**
 * How an observation stops being unverified.
 *
 * Not a new tool: promoting is writing a record, and the two methods that
 * write records already exist. A separate `promote_observation` would have
 * added a twenty-fourth thing for a model to hold in its head to do something
 * `log_entry` was already the verb for.
 */
describe("from_observation_id", () => {
  it("is accepted by the two writes that can promote", () => {
    expect(
      parseParams("logEntry", { task_id: 1, kind: "decision", body: "x", from_observation_id: 3 })
        .from_observation_id,
    ).toBe(3);
    expect(
      parseParams("addContext", {
        kind: "gotcha",
        title: "x",
        body: "x",
        from_observation_id: 4,
      }).from_observation_id,
    ).toBe(4);
  });

  it("must be an integer, because it is a row id", () => {
    expect(() =>
      parseParams("logEntry", { task_id: 1, kind: "note", body: "x", from_observation_id: "3" }),
    ).toThrow();
    expect(() =>
      parseParams("logEntry", { task_id: 1, kind: "note", body: "x", from_observation_id: 1.5 }),
    ).toThrow();
  });
});
