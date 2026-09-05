import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sweep that the comment above `feed` had been claiming for months.
 *
 * `feed` counts unread with a window function, which runs before LIMIT and so
 * reads every notification the account has. Its own comment said that was
 * affordable "which is why `purgeRead` exists" -- and nothing called
 * `purgeRead`. The table grew without bound and the sentence explaining why
 * that was fine was the only thing holding the claim up.
 *
 * `pnpm test` has no database, so what is checked here is that the write path
 * still reaches the sweep and that the statement is shaped the way
 * `lib/db/client.ts` requires. The behaviour -- old-and-read goes, recent-and-
 * read and unread stay -- was run against a real Postgres.
 */
const db = vi.hoisted(() => ({ run: vi.fn(), all: vi.fn(), one: vi.fn() }));
vi.mock("../db/client", () => ({
  run: db.run,
  all: db.all,
  one: db.one,
}));

const notifications = await import("./notifications");

beforeEach(() => {
  vi.clearAllMocks();
  db.run.mockResolvedValue(1);
});

describe("creating a notification sweeps the read ones", () => {
  it("writes the notification and then sweeps", async () => {
    await notifications.create({ userId: 7, kind: "member_removed" });
    // Two statements: the INSERT, and the DELETE riding behind it.
    await vi.waitFor(() => expect(db.run).toHaveBeenCalledTimes(2));
    expect(db.run.mock.calls[0]![0]).toContain("INSERT INTO notifications");
    expect(db.run.mock.calls[1]![0]).toContain("DELETE FROM notifications");
  });

  /**
   * MUTATION CHECK. Moving the sweep onto `feed` is the obvious alternative and
   * it is wrong: `feed` runs on every page load for every signed-in person, so
   * a DELETE there is a write nobody asked for on the hottest read in the app.
   * A notification is created rarely, which is exactly the frequency a sweep
   * wants. This fails if the sweep is moved.
   */
  it("never sweeps on the read path", async () => {
    db.all.mockResolvedValue([]);
    await notifications.feed(7, 20);
    expect(db.run).not.toHaveBeenCalled();
  });

  it("only ever deletes rows that were read, and only old ones", () => {
    const sql = db.run.mock.calls;
    void sql;
    // Asserted on the statement rather than on a result, because the danger is
    // a WHERE that loses half its condition: without `read_at IS NOT NULL` this
    // deletes the unread notifications, which are the only ones anybody is
    // waiting to see.
    return notifications.purgeReadOlderThan(30).then(() => {
      const text = db.run.mock.calls.at(-1)![0] as string;
      expect(text).toContain("read_at IS NOT NULL");
      expect(text).toContain("read_at <");
    });
  });

  it("does not let housekeeping fail the notification", async () => {
    // The caller is waiting on the notification; the sweep is tidying up.
    db.run.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error("sweep exploded"));
    await expect(notifications.create({ userId: 7, kind: "member_removed" })).resolves.toBe(1);
  });
});
