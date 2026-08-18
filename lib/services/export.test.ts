import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What an export carries, and what it must never carry.
 *
 * The round trip is proved end to end against a real database (export, import
 * into an empty account, export again, compare). What that cannot cheaply prove
 * is the two edges: that the bundle refuses rather than truncates, and that the
 * rows it selects are the owner's alone. Both are asserted here on the SQL,
 * because a `WHERE` that stops restricting is exactly the kind of change that
 * leaves every count looking healthy.
 */
const mocks = vi.hoisted(() => ({ all: vi.fn(), one: vi.fn() }));

vi.mock("../db/client", () => ({ all: mocks.all, one: mocks.one }));

const { exportAccount, ExportTooLarge, EXPORT_MAX_ROWS } = await import("./export");

/** Every statement the export ran, as one blob to make assertions about. */
const sql = () => mocks.all.mock.calls.map(([text]) => String(text)).join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.one.mockResolvedValue({ n: "12" });
  mocks.all.mockResolvedValue([]);
});

describe("the ceiling", () => {
  it("refuses an account too big to carry in one file", async () => {
    // Deliberately not the "say what you left out and carry on" that every
    // other ceiling here uses. A briefing is a summary and may be partial; a
    // backup that silently stops is one somebody trusts and finds short on the
    // day they need it.
    mocks.one.mockResolvedValue({ n: String(EXPORT_MAX_ROWS + 1) });
    await expect(exportAccount(7)).rejects.toThrow(ExportTooLarge);
  });

  it("reads nothing at all when it is going to refuse", async () => {
    mocks.one.mockResolvedValue({ n: String(EXPORT_MAX_ROWS + 1) });
    await expect(exportAccount(7)).rejects.toThrow();
    expect(mocks.all).not.toHaveBeenCalled();
  });

  it("carries an account exactly at the limit", async () => {
    mocks.one.mockResolvedValue({ n: String(EXPORT_MAX_ROWS) });
    await expect(exportAccount(7)).resolves.toBeTruthy();
  });
});

describe("whose rows it selects", () => {
  it("scopes every statement to one account", async () => {
    // The property that matters, asserted the way `ownership.test.ts` says to:
    // on the restriction, not on the parameters. Every read here either names
    // `user_id` directly or joins through the owned-projects subquery, and one
    // that stopped doing so would still return rows and still look fine.
    await exportAccount(7);
    for (const [text] of mocks.all.mock.calls) {
      const statement = String(text);
      expect(statement).toMatch(/user_id = \?|project_id IN \(SELECT id FROM projects WHERE user_id = \?\)/);
    }
  });

  it("takes projects this account owns, not ones shared with it", async () => {
    // `ACCESS_SELECT` elsewhere includes shared projects on purpose, because
    // reading them is what sharing is for. Copying them is not: they belong to
    // whoever made them.
    await exportAccount(7);
    expect(sql()).not.toContain("project_memberships");
  });

  it("passes the account to every statement it runs", async () => {
    await exportAccount(7);
    for (const [, params] of mocks.all.mock.calls) {
      expect(params as unknown[]).toContain(7);
    }
  });
});

describe("what is left out", () => {
  it("selects no credential, and no column belonging to another person", async () => {
    // Each of these is a decision recorded in the module's own comment: a
    // password hash is not something anybody needs a copy of, a share token is
    // a capability, and memberships, invitations and notifications all name
    // somebody who did not ask to be in your download.
    await exportAccount(7);
    const statements = sql();
    for (const forbidden of [
      "password_hash",
      "share_token",
      "token_hash",
      "project_memberships",
      "project_invitations",
      "notifications",
      "sessions",
      "api_tokens",
    ]) {
      expect(statements).not.toContain(forbidden);
    }
  });

  it("keeps the author of an entry without naming the account", async () => {
    // `author` says agent or human, which is what the log is about. `user_id`
    // names a row in `users`, which is not this account's to hand out.
    await exportAccount(7);
    const entries = mocks.all.mock.calls.map(([t]) => String(t)).find((t) => t.includes("FROM entries"));
    expect(entries).toContain("e.author");
    expect(entries).not.toContain("e.user_id");
  });
});

describe("the bundle", () => {
  it("names its format and version, so an importer can refuse an unknown one", async () => {
    const bundle = await exportAccount(7);
    expect(bundle.format).toBe("todox-export");
    expect(bundle.version).toBe(1);
  });

  it("carries task events, because every duration is derived from them", async () => {
    // Without these a report on the restored copy reads zero everywhere, which
    // is confidently wrong rather than visibly missing.
    await exportAccount(7);
    expect(sql()).toContain("FROM task_events");
  });

  it("carries the file hashes, which the server cannot recompute", async () => {
    // It has never seen the files. Dropping them would make every restored note
    // read "not checked" until an agent looked at each one again.
    await exportAccount(7);
    const refs = mocks.all.mock.calls.map(([t]) => String(t)).find((t) => t.includes("FROM refs"));
    expect(refs).toContain("r.hash");
    expect(refs).toContain("r.hash_seen");
  });
});
