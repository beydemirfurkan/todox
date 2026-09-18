import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a session is told it still owes.
 *
 * The wrap-up contract was never the problem; the list was. Measured on one
 * account over eighteen days, 78 tasks were opened and 29 closed, and the
 * ones left 'doing' for weeks turned the report's hours into fiction. These
 * tests pin the two questions the answer is built from: which tasks are this
 * user's from this window, and whether the last thing they did on each was
 * write it up.
 */
const mocks = vi.hoisted(() => ({
  touchedByUserSince: vi.fn(),
  pageByProject: vi.fn(),
  eventActivity: vi.fn(),
  entryActivity: vi.fn(),
}));

vi.mock("../repositories/tasks", () => ({
  touchedByUserSince: mocks.touchedByUserSince,
  pageByProject: mocks.pageByProject,
}));
vi.mock("../repositories/events", () => ({ activityByTasks: mocks.eventActivity }));
vi.mock("../repositories/entries", () => ({ activityByTasks: mocks.entryActivity }));

const { sessionStatus, DEFAULT_WINDOW_HOURS } = await import("./session-status");

const NOW = Date.parse("2026-09-18T12:00:00Z");
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const PROJECT = { id: 7, slug: "todox", name: "todox" } as never;
const ME = 11;

const task = (id: number, status: string, updatedHoursAgo: number) => ({
  id,
  project_id: 7,
  title: `task ${id}`,
  body: null,
  status,
  priority: 2,
  created_at: ago(240),
  updated_at: ago(updatedHoursAgo),
  closed_at: null,
});

const events = (
  rows: [number, { latest_at: string; latest_to_status: string; last_by_user_at: string | null }][],
) => new Map(rows.map(([id, r]) => [id, { task_id: id, ...r }]));

const entries = (
  rows: [
    number,
    {
      last_at: string;
      last_handoff_at: string | null;
      last_by_user_at: string | null;
      last_non_handoff_by_user_at: string | null;
    },
  ][],
) => new Map(rows.map(([id, r]) => [id, { task_id: id, ...r }]));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.touchedByUserSince.mockResolvedValue([]);
  mocks.pageByProject.mockResolvedValue({ rows: [], total: 0 });
  mocks.eventActivity.mockResolvedValue(new Map());
  mocks.entryActivity.mockResolvedValue(new Map());
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("the window", () => {
  it("asks for this user's tasks since twelve hours ago by default", async () => {
    await sessionStatus(ME, PROJECT);
    expect(mocks.touchedByUserSince).toHaveBeenCalledWith(
      7,
      ME,
      ago(DEFAULT_WINDOW_HOURS),
      expect.any(Number),
    );
  });

  it("honours a window the caller names, and reports it back", async () => {
    const status = await sessionStatus(ME, PROJECT, { hours: 3 });
    expect(mocks.touchedByUserSince).toHaveBeenCalledWith(7, ME, ago(3), expect.any(Number));
    expect(status.window_hours).toBe(3);
  });
});

describe("what is yours", () => {
  it("owes a handoff on a task this user set 'doing' and wrote nothing on", async () => {
    mocks.touchedByUserSince.mockResolvedValue([task(1, "doing", 1)]);
    mocks.eventActivity.mockResolvedValue(
      events([[1, { latest_at: ago(1), latest_to_status: "doing", last_by_user_at: ago(1) }]]),
    );
    const { yours } = await sessionStatus(ME, PROJECT);
    expect(yours).toEqual([
      { id: 1, title: "task 1", status: "doing", last_activity_at: ago(1), handoff_missing: true },
    ]);
  });

  it("owes nothing on a task whose last touch by this user was the handoff itself", async () => {
    mocks.touchedByUserSince.mockResolvedValue([task(1, "done", 1)]);
    mocks.eventActivity.mockResolvedValue(
      events([[1, { latest_at: ago(2), latest_to_status: "done", last_by_user_at: ago(2) }]]),
    );
    mocks.entryActivity.mockResolvedValue(
      entries([
        [
          1,
          {
            last_at: ago(1),
            last_handoff_at: ago(1),
            last_by_user_at: ago(1),
            last_non_handoff_by_user_at: ago(3),
          },
        ],
      ]),
    );
    const { yours } = await sessionStatus(ME, PROJECT);
    expect(yours[0]).toMatchObject({ status: "done", handoff_missing: false });
  });

  it("owes a handoff again when this user did more after the last one", async () => {
    // A handoff from an earlier session says nothing about a decision logged
    // since. The moment a handoff is owed from is the last non-handoff touch.
    mocks.touchedByUserSince.mockResolvedValue([task(1, "doing", 1)]);
    mocks.eventActivity.mockResolvedValue(
      events([[1, { latest_at: ago(30), latest_to_status: "doing", last_by_user_at: ago(30) }]]),
    );
    mocks.entryActivity.mockResolvedValue(
      entries([
        [
          1,
          {
            last_at: ago(1),
            last_handoff_at: ago(20),
            last_by_user_at: ago(1),
            last_non_handoff_by_user_at: ago(1),
          },
        ],
      ]),
    );
    const { yours } = await sessionStatus(ME, PROJECT);
    expect(yours[0]).toMatchObject({ last_activity_at: ago(1), handoff_missing: true });
  });

  it("takes a teammate's handoff as the write-up when it came after this user's last touch", async () => {
    mocks.touchedByUserSince.mockResolvedValue([task(1, "doing", 1)]);
    mocks.eventActivity.mockResolvedValue(
      events([[1, { latest_at: ago(4), latest_to_status: "doing", last_by_user_at: ago(4) }]]),
    );
    // `last_handoff_at` is anyone's; this user's own entries are none.
    mocks.entryActivity.mockResolvedValue(
      entries([
        [
          1,
          {
            last_at: ago(1),
            last_handoff_at: ago(1),
            last_by_user_at: null,
            last_non_handoff_by_user_at: null,
          },
        ],
      ]),
    );
    const { yours } = await sessionStatus(ME, PROJECT);
    expect(yours[0]!.handoff_missing).toBe(false);
  });

  it("is empty when the repository found nothing, and so is the hint", async () => {
    const status = await sessionStatus(ME, PROJECT);
    expect(status.yours).toEqual([]);
    expect(status.stale).toEqual([]);
    expect(status.hint).toBe("");
  });
});

describe("what is stale", () => {
  it("names a task 'doing' with nothing logged for a week, by anyone", async () => {
    mocks.pageByProject.mockResolvedValue({ rows: [task(5, "doing", 23 * 24)], total: 1 });
    mocks.eventActivity.mockResolvedValue(
      events([[5, { latest_at: ago(23 * 24), latest_to_status: "doing", last_by_user_at: null }]]),
    );
    const { stale } = await sessionStatus(ME, PROJECT);
    expect(stale).toEqual([{ id: 5, title: "task 5", doing_since: ago(23 * 24), idle_days: 23 }]);
    expect(mocks.pageByProject).toHaveBeenCalledWith(7, "doing", expect.any(Number));
  });

  it("does not call a task stale that somebody wrote on yesterday", async () => {
    // `updated_at` moves with every entry and status change, so an eight-day
    // 'doing' with an entry yesterday is live, not abandoned.
    mocks.pageByProject.mockResolvedValue({ rows: [task(5, "doing", 24)], total: 1 });
    const { stale } = await sessionStatus(ME, PROJECT);
    expect(stale).toEqual([]);
  });
});

describe("the hint", () => {
  it("names the ids, one sentence per thing owed", async () => {
    mocks.touchedByUserSince.mockResolvedValue([task(1, "doing", 1), task(2, "done", 2)]);
    mocks.pageByProject.mockResolvedValue({
      rows: [task(1, "doing", 1), task(9, "doing", 10 * 24)],
      total: 2,
    });
    mocks.eventActivity.mockResolvedValue(
      events([
        [1, { latest_at: ago(1), latest_to_status: "doing", last_by_user_at: ago(1) }],
        [2, { latest_at: ago(2), latest_to_status: "done", last_by_user_at: ago(2) }],
        [9, { latest_at: ago(10 * 24), latest_to_status: "doing", last_by_user_at: null }],
      ]),
    );
    mocks.entryActivity.mockResolvedValue(
      entries([
        [
          2,
          {
            last_at: ago(1.5),
            last_handoff_at: ago(1.5),
            last_by_user_at: ago(1.5),
            last_non_handoff_by_user_at: ago(2),
          },
        ],
      ]),
    );
    const { hint } = await sessionStatus(ME, PROJECT);
    expect(hint).toMatch(/Still 'doing' from this session: #1\./);
    expect(hint).toMatch(/No handoff since you last touched: #1\./);
    expect(hint).not.toMatch(/#2/);
    expect(hint).toMatch(/7\+ days with nothing logged: #9\./);
  });
});
