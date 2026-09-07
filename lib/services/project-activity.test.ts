import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "../types";

const projects = vi.hoisted(() => ({ list: vi.fn() }));
const tasks = vi.hoisted(() => ({ latestUpdatedByProjects: vi.fn() }));
const contexts = vi.hoisted(() => ({ latestUpdatedByProjects: vi.fn() }));

vi.mock("../repositories/projects", () => projects);
vi.mock("../repositories/tasks", () => tasks);
vi.mock("../repositories/contexts", () => contexts);

const { listRecent } = await import("./project-activity");

const project = (id: number, createdAt: string): Project => ({
  id,
  user_id: 7,
  slug: `project-${id}`,
  name: `Project ${id}`,
  root_path: `/repo/${id}`,
  repo_url: null,
  summary: null,
  archived: 0,
  created_at: createdAt,
  share_token: null,
  share_log: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  tasks.latestUpdatedByProjects.mockResolvedValue(new Map());
  contexts.latestUpdatedByProjects.mockResolvedValue(new Map());
});

describe("listRecent", () => {
  it("orders projects by their newest task or curated note", async () => {
    projects.list.mockResolvedValue([
      project(1, "2026-09-01T00:00:00.000Z"),
      project(2, "2026-09-02T00:00:00.000Z"),
      project(3, "2026-09-03T00:00:00.000Z"),
    ]);
    tasks.latestUpdatedByProjects.mockResolvedValue(
      new Map([[1, "2026-09-07T12:00:00.000Z"]]),
    );
    contexts.latestUpdatedByProjects.mockResolvedValue(
      new Map([[2, "2026-09-08T12:00:00.000Z"]]),
    );

    const rows = await listRecent(7);

    expect(rows.map((row) => row.id)).toEqual([2, 1, 3]);
    expect(rows.map((row) => row.activity_at)).toEqual([
      "2026-09-08T12:00:00.000Z",
      "2026-09-07T12:00:00.000Z",
      "2026-09-03T00:00:00.000Z",
    ]);
    expect(tasks.latestUpdatedByProjects).toHaveBeenCalledOnce();
    expect(tasks.latestUpdatedByProjects).toHaveBeenCalledWith([1, 2, 3]);
    expect(contexts.latestUpdatedByProjects).toHaveBeenCalledOnce();
    expect(contexts.latestUpdatedByProjects).toHaveBeenCalledWith([1, 2, 3]);
  });

  it("uses the project creation time when it has no work yet", async () => {
    projects.list.mockResolvedValue([project(4, "2026-09-06T09:00:00.000Z")]);

    await expect(listRecent(7)).resolves.toMatchObject([
      { id: 4, activity_at: "2026-09-06T09:00:00.000Z" },
    ]);
  });

  it("breaks equal timestamps with the newest project id", async () => {
    projects.list.mockResolvedValue([
      project(5, "2026-09-06T09:00:00.000Z"),
      project(6, "2026-09-06T09:00:00.000Z"),
    ]);

    expect((await listRecent(7)).map((row) => row.id)).toEqual([6, 5]);
  });

  it("does not ask activity repositories about an empty account", async () => {
    projects.list.mockResolvedValue([]);

    await expect(listRecent(7)).resolves.toEqual([]);
    expect(tasks.latestUpdatedByProjects).not.toHaveBeenCalled();
    expect(contexts.latestUpdatedByProjects).not.toHaveBeenCalled();
  });
});
