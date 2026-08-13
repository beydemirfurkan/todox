import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The one place that answers "does this row belong to this account?".
 *
 * It is all SQL, so a database would be needed to prove it returns the right
 * rows — and the smoke suites do that. What is asserted here is the discipline
 * the SQL has to keep whether or not a database is reachable, because every
 * one of these is a way to leak somebody else's row and none of them fails
 * loudly:
 *
 *   - a query that forgets to bind the account is a query that answers "yes"
 *     for everyone;
 *   - `lib/db/client.ts` rewrites `?` to `$n` by position, so a placeholder
 *     without a parameter shifts every binding after it — the id lands where
 *     the user id was checked;
 *   - the ids come from URLs, form fields and MCP arguments, so any of them
 *     reaching the statement as text rather than a parameter is an injection.
 */
const db = vi.hoisted(() => ({
  one: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
}));

vi.mock("../db/client", () => db);

const ownership = await import("./ownership");
const { NotYours } = ownership;

const USER = 7;
const ID = 42;

/** Every ownership predicate, with the argument order they all share. */
const PREDICATES = [
  "ownsProject",
  "accessesProject",
  "ownsTask",
  "ownsEntry",
  "ownsRef",
  "ownsContext",
] as const;

type Predicate = (typeof PREDICATES)[number];

/** Run one predicate and hand back the statement it built. */
async function statementFor(name: Predicate): Promise<{ text: string; params: unknown[] }> {
  db.one.mockResolvedValue(undefined);
  db.one.mockClear();
  await (ownership[name] as (u: number, i: number) => Promise<boolean>)(USER, ID);
  const [text, params] = db.one.mock.calls[0] as [string, unknown[]];
  return { text, params };
}

/**
 * Placeholders outside string literals. `lib/db/client.ts` does not parse
 * strings, which is why the codebase bans `?` inside them — counting the same
 * way here keeps this test honest about what the rewriter will see.
 */
function placeholderCount(sql: string): number {
  return (sql.replace(/'[^']*'/g, "''").match(/\?/g) ?? []).length;
}

/**
 * Everything after `WHERE`, which is the only part that restricts the rows.
 *
 * A `LEFT JOIN … ON pm.user_id = ?` binds the account without constraining
 * anything: unmatched rows still come back, with nulls. So "the account
 * appears in the parameters" is not the property worth asserting — it stayed
 * true when the ownership condition was deleted from the WHERE and the query
 * began answering yes for every task in the database.
 */
function whereClause(sql: string): string {
  const parts = sql.split(/\bWHERE\b/i);
  if (parts.length < 2) throw new Error(`no WHERE clause in: ${sql}`);
  return parts.slice(1).join(" WHERE ");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("every ownership query", () => {
  for (const name of PREDICATES) {
    describe(name, () => {
      it("binds one parameter per placeholder", async () => {
        // Positional rewriting means a mismatch does not throw — it silently
        // shifts every binding after the gap.
        const { text, params } = await statementFor(name);
        expect(placeholderCount(text)).toBe(params.length);
      });

      it("scopes the row to the account", async () => {
        const { params } = await statementFor(name);
        expect(params).toContain(USER);
      });

      it("restricts on an account column in the WHERE, not just in a join", async () => {
        // Deleting the ownership condition from the WHERE leaves the account
        // bound in the LEFT JOIN and the parameter count unchanged, so every
        // other assertion here still passes while the query answers yes for
        // every row in the table. This is the one that notices.
        const where = whereClause((await statementFor(name)).text);
        expect(where).toMatch(/user_id/);
      });

      it("binds the account inside the WHERE", async () => {
        const where = whereClause((await statementFor(name)).text);
        // The id is one of them; an ownership check needs at least one more.
        expect(placeholderCount(where)).toBeGreaterThanOrEqual(2);
      });

      it("binds the id rather than interpolating it", async () => {
        const { text, params } = await statementFor(name);
        expect(params).toContain(ID);
        expect(text).not.toContain(String(ID));
      });

      it("keeps no `?` inside a string literal", async () => {
        // The rewriter would renumber it and the statement would bind wrong.
        const { text } = await statementFor(name);
        const insideLiterals = text.match(/'[^']*'/g) ?? [];
        for (const literal of insideLiterals) expect(literal).not.toContain("?");
      });

      it("answers false when the row is not there, true when it is", async () => {
        const run = ownership[name] as (u: number, i: number) => Promise<boolean>;
        db.one.mockResolvedValue(undefined);
        await expect(run(USER, ID)).resolves.toBe(false);
        db.one.mockResolvedValue({ n: 1 });
        await expect(run(USER, ID)).resolves.toBe(true);
      });
    });
  }
});

describe("owner-only versus shared", () => {
  it("ownsProject asks about the owner column alone", async () => {
    // Project settings, sharing and deletion are the owner's; a member passing
    // this check would be able to rename or unshare somebody else's project.
    const { text } = await statementFor("ownsProject");
    expect(text).toContain("user_id = ?");
    expect(text).not.toContain("project_memberships");
  });

  it("accessesProject and the row-level checks admit members", async () => {
    for (const name of ["accessesProject", "ownsTask", "ownsEntry", "ownsRef"] as const) {
      const { text } = await statementFor(name);
      expect(text, name).toContain("project_memberships");
    }
  });
});

describe("NotYours", () => {
  it("does not say whether the id exists", async () => {
    // A message that distinguished the two would turn this check into a probe
    // for which ids are real in other people's accounts.
    const message = new NotYours("task", 99).message;
    expect(message).toBe("task #99 does not exist or is not yours");
    expect(message).not.toMatch(/belongs to|another|other user|forbidden/i);
  });

  it("is an Error subclass, so a catch that filters on it works", () => {
    const e = new NotYours("task", 1);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("NotYours");
  });
});

describe("the assert wrappers", () => {
  const CASES = [
    ["assertProject", "project"],
    ["assertTask", "task"],
    ["assertEntry", "entry"],
    ["assertRef", "ref"],
    ["assertContext", "context"],
  ] as const;

  for (const [fn, label] of CASES) {
    it(`${fn} throws NotYours naming "${label}" when the row is not the account's`, async () => {
      db.one.mockResolvedValue(undefined);
      const assert = ownership[fn] as (u: number, i: number) => Promise<void>;

      await expect(assert(USER, ID)).rejects.toThrow(NotYours);
      await expect(assert(USER, ID)).rejects.toThrow(`${label} #${ID} does not exist or is not yours`);
    });

    it(`${fn} resolves quietly when it is`, async () => {
      db.one.mockResolvedValue({ n: 1 });
      const assert = ownership[fn] as (u: number, i: number) => Promise<void>;

      await expect(assert(USER, ID)).resolves.toBeUndefined();
    });
  }
});
