import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectFolder, ProjectPlacement } from "../types";

/**
 * Folders, pins and the archive arrange one person's list and nothing else.
 * What goes wrong here is quiet: a project listed twice, a project that
 * vanishes because its folder did, or a write into somebody else's folder
 * that the 404 should have stopped before the database had to.
 */
const mocks = vi.hoisted(() => ({
  assertProjectAccess: vi.fn(async () => undefined),
  assertFolder: vi.fn(async () => undefined),
  setFolder: vi.fn(async () => 1),
  setPinnedAt: vi.fn(async () => 1),
  setArchivedAt: vi.fn(async (..._args: unknown[]) => 1),
  findOrCreate: vi.fn(async (userId: number, name: string) => ({ id: 77, user_id: userId, name })),
  listFolders: vi.fn(async (): Promise<ProjectFolder[]> => []),
  rename: vi.fn(async () => 1),
  remove: vi.fn(async () => 1),
}));

vi.mock("./ownership", () => ({
  assertProjectAccess: mocks.assertProjectAccess,
  assertFolder: mocks.assertFolder,
}));
vi.mock("../repositories/project-placements", () => ({
  listByUser: vi.fn(async () => []),
  setFolder: mocks.setFolder,
  setPinnedAt: mocks.setPinnedAt,
  setArchivedAt: mocks.setArchivedAt,
}));
vi.mock("../repositories/project-folders", () => ({
  FOLDER_NAME_MAX: 60,
  listByUser: mocks.listFolders,
  findOrCreate: mocks.findOrCreate,
  rename: mocks.rename,
  remove: mocks.remove,
}));

const org = await import("./project-organization");

const USER = 7;
const folder = (id: number, name: string): ProjectFolder => ({
  id,
  user_id: USER,
  name,
  position: 0,
  created_at: "2026-11-01T00:00:00.000Z",
});
const placed = (projectId: number, over: Partial<ProjectPlacement> = {}): ProjectPlacement => ({
  user_id: USER,
  project_id: projectId,
  folder_id: null,
  pinned_at: null,
  archived_at: null,
  ...over,
});
/** Newest activity first, the order `listRecent` hands over. */
const projects = [1, 2, 3, 4, 5].map((id) => ({ id }));
const ids = (list: { id: number }[]) => list.map((p) => p.id);

beforeEach(() => vi.clearAllMocks());

describe("arrange", () => {
  it("is the plain list, in its order, when nothing is arranged", () => {
    const out = org.arrange({ projects, placements: [], folders: [] });
    expect(ids(out.loose)).toEqual([1, 2, 3, 4, 5]);
    expect(out.pinned).toEqual([]);
    expect(out.folders).toEqual([]);
    expect(out.archived).toEqual([]);
  });

  it("lists every project exactly once: archive over pin over folder", () => {
    const out = org.arrange({
      projects,
      folders: [folder(10, "work")],
      placements: [
        placed(1, { folder_id: 10, pinned_at: "2026-11-02", archived_at: "2026-11-03" }),
        placed(2, { folder_id: 10, pinned_at: "2026-11-02" }),
        placed(3, { folder_id: 10 }),
      ],
    });
    expect(ids(out.archived)).toEqual([1]);
    expect(ids(out.pinned)).toEqual([2]);
    expect(ids(out.folders[0].projects)).toEqual([3]);
    expect(ids(out.loose)).toEqual([4, 5]);
    const all = [...out.archived, ...out.pinned, ...out.folders.flatMap((f) => f.projects), ...out.loose];
    expect(ids(all).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps pins in the order they were made, not by activity", () => {
    const out = org.arrange({
      projects,
      folders: [],
      placements: [placed(1, { pinned_at: "2026-11-05" }), placed(4, { pinned_at: "2026-11-01" })],
    });
    expect(ids(out.pinned)).toEqual([4, 1]);
  });

  it("keeps activity order inside a folder, and shows an empty folder", () => {
    const out = org.arrange({
      projects,
      folders: [folder(10, "work"), folder(11, "later")],
      placements: [placed(5, { folder_id: 10 }), placed(2, { folder_id: 10 })],
    });
    expect(ids(out.folders[0].projects)).toEqual([2, 5]);
    expect(out.folders[1]).toEqual({ id: 11, name: "later", projects: [] });
  });

  it("does not lose a project whose folder is gone", () => {
    const out = org.arrange({ projects, folders: [], placements: [placed(3, { folder_id: 99 })] });
    expect(ids(out.loose)).toContain(3);
  });

  it("ignores a placement for a project no longer in the list", () => {
    const out = org.arrange({ projects, folders: [], placements: [placed(42, { pinned_at: "2026-11-01" })] });
    expect(out.pinned).toEqual([]);
  });
});

describe("folder names", () => {
  it("trims and folds whitespace onto one line", () => {
    expect(org.folderName("  client\n work  ")).toBe("client work");
  });

  it.each(["", "   ", "x".repeat(61)])("refuses %j", (name) => {
    expect(() => org.folderName(name)).toThrow();
  });
});

describe("writes ask ownership first", () => {
  it("checks the project and the folder before moving into it", async () => {
    await org.moveToFolder(USER, 3, { folderId: 10 });
    expect(mocks.assertProjectAccess).toHaveBeenCalledWith(USER, 3);
    expect(mocks.assertFolder).toHaveBeenCalledWith(USER, 10);
    expect(mocks.setFolder).toHaveBeenCalledWith(USER, 3, 10);
  });

  it("writes nothing when the folder is somebody else's", async () => {
    mocks.assertFolder.mockRejectedValueOnce(new Error("folder #10 does not exist or is not yours"));
    await expect(org.moveToFolder(USER, 3, { folderId: 10 })).rejects.toThrow("not yours");
    expect(mocks.setFolder).not.toHaveBeenCalled();
  });

  it("writes nothing when the project is not visible to this person", async () => {
    mocks.assertProjectAccess.mockRejectedValueOnce(new Error("project #3 does not exist or is not yours"));
    await expect(org.pinProject(USER, 3)).rejects.toThrow("not yours");
    expect(mocks.setPinnedAt).not.toHaveBeenCalled();
  });

  it("moves into a folder named on the spot, made for this person", async () => {
    await org.moveToFolder(USER, 3, { newFolderName: " Clients " });
    expect(mocks.findOrCreate).toHaveBeenCalledWith(USER, "Clients");
    expect(mocks.setFolder).toHaveBeenCalledWith(USER, 3, 77);
  });

  it("takes a project out of any folder", async () => {
    await org.moveToFolder(USER, 3, { none: true });
    expect(mocks.setFolder).toHaveBeenCalledWith(USER, 3, null);
  });

  it("refuses a rename onto another folder's name, whatever its case", async () => {
    mocks.listFolders.mockResolvedValueOnce([folder(10, "Work"), folder(11, "later")]);
    await expect(org.renameFolder(USER, 11, "work")).rejects.toThrow('"Work"');
    expect(mocks.rename).not.toHaveBeenCalled();
  });

  it("lets a folder change only its own case", async () => {
    mocks.listFolders.mockResolvedValueOnce([folder(10, "work")]);
    await org.renameFolder(USER, 10, "Work");
    expect(mocks.rename).toHaveBeenCalledWith(10, "Work");
  });

  it("archives and unarchives with a timestamp and a null", async () => {
    await org.archiveProject(USER, 4);
    await org.unarchiveProject(USER, 4);
    expect(mocks.setArchivedAt.mock.calls[0][2]).toEqual(expect.any(String));
    expect(mocks.setArchivedAt.mock.calls[1][2]).toBeNull();
  });
});
