import { describe, expect, it } from "vitest";

import { SCHEMA, statements } from "./schema";

/**
 * The observations table is the automatic half of the log, and it is a
 * separate table on purpose: material nobody has vouched for must not be able
 * to reach `entries`, which is the curated record the product's claim rests
 * on. A foreign key would not have kept them apart; two tables do.
 */
describe("observations", () => {
  it("is declared", () => {
    expect(SCHEMA).toContain("CREATE TABLE IF NOT EXISTS observations");
  });

  /**
   * One row per session per project, and the upsert needs somewhere to land.
   * Without this index `ON CONFLICT (user_id, project_id, session_id)` is not
   * an inference Postgres can make, and every throttled write during a session
   * would append a row instead of replacing one.
   */
  it("keeps one row per session per project", () => {
    expect(SCHEMA).toContain("uq_observations_session");
  });

  /**
   * The briefing's read, and the reason it can be cut without a sequential
   * scan on the call every session opens with. Partial on `promoted_at IS
   * NULL` because a promoted observation is never read again -- it has become
   * an entry, and showing it twice is the noise this design exists to avoid.
   */
  it("indexes the briefing's read", () => {
    expect(SCHEMA).toContain("idx_observations_briefing");
  });

  /** Retention is swept opportunistically, so the sweep needs its own index. */
  it("indexes the expiry sweep", () => {
    expect(SCHEMA).toContain("idx_observations_expiry");
  });
});

/**
 * Two hazards this file's own comment describes and nothing asserted.
 *
 * `statements()` splits on `;` and strips `--` lines *after* the split, so a
 * semicolon inside prose cuts a comment in half and the tail of the sentence
 * arrives at Postgres as the start of a statement -- a syntax error at
 * position 1 on a word from the middle of an explanation. A `DO $$ ... $$`
 * block cannot be expressed here at all, for the same reason.
 */
describe("the schema survives being split on semicolons", () => {
  const SQL_VERBS = ["CREATE", "ALTER", "INSERT", "UPDATE", "DELETE", "DROP", "COMMENT"];

  it("produces nothing but statements", () => {
    for (const statement of statements()) {
      const verb = statement.split(/\s+/)[0]?.toUpperCase() ?? "";
      expect(SQL_VERBS, `not a statement: ${statement.slice(0, 60)}`).toContain(verb);
    }
  });

  /**
   * A partial run has to be able to resume, because `db:migrate` is a separate
   * deploy step that can be interrupted.
   */
  it("is idempotent statement by statement", () => {
    for (const statement of statements()) {
      if (!statement.toUpperCase().startsWith("CREATE")) continue;
      expect(statement.toUpperCase(), statement.slice(0, 60)).toContain("IF NOT EXISTS");
    }
  });
});
