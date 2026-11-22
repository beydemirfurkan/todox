import { beforeEach, describe, expect, it, vi } from "vitest";

const users = { findPublicProfile: vi.fn() };
const entries = {
  dailyKindsByAuthor: vi.fn(),
  modelsSince: vi.fn(),
  kindCountsByProjectSince: vi.fn(),
};
const tasks = { countDoneSince: vi.fn(), countsByProject: vi.fn() };
const projects = { listOnProfile: vi.fn() };
const contexts = { publicNotes: vi.fn() };

vi.mock("../repositories/users", () => users);
vi.mock("../repositories/entries", () => entries);
vi.mock("../repositories/tasks", () => tasks);
vi.mock("../repositories/projects", () => projects);
vi.mock("../repositories/contexts", () => contexts);

const { publicProfile } = await import("./profile");

const empty = { todo: 0, doing: 0, blocked: 0, done: 0, dropped: 0 };

describe("publicProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    entries.dailyKindsByAuthor.mockResolvedValue([
      { day: "2026-11-20", kind: "decision", n: 2 },
      { day: "2026-11-20", kind: "note", n: 1 },
      { day: "2026-11-21", kind: "dead_end", n: 1 },
    ]);
    entries.modelsSince.mockResolvedValue([]);
    entries.kindCountsByProjectSince.mockResolvedValue([{ project_id: 7, kind: "decision", n: 3 }]);
    tasks.countDoneSince.mockResolvedValue(4);
    tasks.countsByProject.mockResolvedValue({
      map: new Map([[7, { ...empty, done: 5, todo: 2, doing: 1 }]]),
      empty,
    });
    projects.listOnProfile.mockResolvedValue([{ id: 7, slug: "api", name: "API", summary: null }]);
    contexts.publicNotes.mockResolvedValue([]);
  });

  it("reads nothing else when the profile is off, missing or unverified", async () => {
    users.findPublicProfile.mockResolvedValue(undefined);
    expect(await publicProfile("ghost")).toBeNull();
    expect(entries.dailyKindsByAuthor).not.toHaveBeenCalled();
    expect(projects.listOnProfile).not.toHaveBeenCalled();
    expect(contexts.publicNotes).not.toHaveBeenCalled();
  });

  it("adds a day up across kinds and counts the days written on", async () => {
    users.findPublicProfile.mockResolvedValue({ id: 1, username: "ada", name: "Ada", bio: null, created_at: "" });
    const p = await publicProfile("ada");
    expect(p?.days).toEqual([
      { day: "2026-11-20", n: 3 },
      { day: "2026-11-21", n: 1 },
    ]);
    expect(p?.totals).toEqual({ entries: 4, decisions: 2, deadEnds: 1, done: 4, activeDays: 2 });
  });

  it("names a marked project by counts only", async () => {
    users.findPublicProfile.mockResolvedValue({ id: 1, username: "ada", name: "Ada", bio: null, created_at: "" });
    const p = await publicProfile("ada");
    expect(p?.projects).toEqual([
      {
        slug: "api",
        name: "API",
        summary: null,
        done: 5,
        open: 3,
        activity: 3,
        decisions: 3,
        deadEnds: 0,
        questions: 0,
      },
    ]);
  });
});
