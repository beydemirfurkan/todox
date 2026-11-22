import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Removing, handing on and deleting a shared project, with the repositories
 * mocked. What is pinned is the order and the guards: who may act, what is
 * read before it disappears, and that a transfer is one transaction.
 */
const membershipsRepo = vi.hoisted(() => ({
  ownedById: vi.fn(),
  removeOwned: vi.fn(),
  listByProject: vi.fn(),
  isAccessSlugTaken: vi.fn(),
  removeForTransferStmt: vi.fn(() => ({ text: "retire heir membership", params: [] })),
  createForTransferStmt: vi.fn((input: unknown) => ({ text: "former owner joins", params: [input] })),
}));
const projectsRepo = vi.hoisted(() => ({
  ownedById: vi.fn(),
  remove: vi.fn(),
  isOwnedSlugTaken: vi.fn(),
  nextFreeSlug: vi.fn(),
  transferStmt: vi.fn((input: unknown) => ({ text: "move project", params: [input] })),
}));
const notificationsRepo = vi.hoisted(() => ({
  create: vi.fn(),
  createStmt: vi.fn((input: unknown) => ({ text: "notify", params: [input] })),
}));
const db = vi.hoisted(() => ({ tx: vi.fn() }));

vi.mock("../repositories/project-memberships", () => membershipsRepo);
vi.mock("../repositories/projects", () => projectsRepo);
vi.mock("../repositories/notifications", () => notificationsRepo);
vi.mock("../db/client", () => db);

const { deleteProject, removeMember, transferOwnership } = await import("./collaboration");

const OWNER = 1;
const HEIR = 2;
const MEMBERSHIP = { id: 30, project_id: 9, user_id: HEIR, access_slug: "api", root_path: "/heir/api" };
const PROJECT = { id: 9, user_id: OWNER, slug: "api", name: "API", root_path: "/owner/api" };

/** The statement texts of the one transaction, in order. */
const written = () => (db.tx.mock.calls[0]?.[0] as { text: string }[]).map((st) => st.text);

beforeEach(() => {
  vi.clearAllMocks();
  membershipsRepo.ownedById.mockResolvedValue(MEMBERSHIP);
  membershipsRepo.isAccessSlugTaken.mockResolvedValue(false);
  projectsRepo.isOwnedSlugTaken.mockResolvedValue(false);
  projectsRepo.ownedById.mockImplementation(async (userId: number) =>
    userId === OWNER ? PROJECT : undefined,
  );
  db.tx.mockReset().mockImplementation(async () => {
    // After the transaction the project belongs to the heir.
    projectsRepo.ownedById.mockImplementation(async (userId: number) =>
      userId === HEIR ? { ...PROJECT, user_id: HEIR } : undefined,
    );
  });
});

describe("transferOwnership", () => {
  it("moves the project, keeps the former owner as a member and tells the heir, in one transaction", async () => {
    expect(await transferOwnership(OWNER, 30)).toEqual({ ok: true, formerOwnerSlug: "api" });
    expect(db.tx).toHaveBeenCalledTimes(1);
    expect(written()).toEqual(["retire heir membership", "move project", "former owner joins", "notify"]);
    expect(projectsRepo.transferStmt).toHaveBeenCalledWith({
      id: 9,
      fromUserId: OWNER,
      toUserId: HEIR,
      slug: "api",
      rootPath: "/heir/api",
    });
    expect(membershipsRepo.createForTransferStmt).toHaveBeenCalledWith({
      projectId: 9,
      fromUserId: OWNER,
      toUserId: HEIR,
      accessSlug: "api",
      rootPath: "/owner/api",
    });
    expect(notificationsRepo.createStmt).toHaveBeenCalledWith(
      expect.objectContaining({ userId: HEIR, kind: "ownership_received", actorId: OWNER }),
    );
  });

  it("answers not-found for a membership in somebody else's project, and writes nothing", async () => {
    membershipsRepo.ownedById.mockResolvedValue(undefined);
    expect(await transferOwnership(OWNER, 30)).toEqual({ ok: false, code: "not-found" });
    expect(db.tx).not.toHaveBeenCalled();
  });

  it("gives the heir a fresh slug when they already own a project under theirs", async () => {
    projectsRepo.isOwnedSlugTaken.mockResolvedValue(true);
    projectsRepo.nextFreeSlug.mockResolvedValue("api-2");
    await transferOwnership(OWNER, 30);
    expect(projectsRepo.transferStmt).toHaveBeenCalledWith(expect.objectContaining({ slug: "api-2" }));
  });

  it("gives the former owner a fresh route when a membership of theirs already uses the slug", async () => {
    membershipsRepo.isAccessSlugTaken.mockResolvedValue(true);
    projectsRepo.nextFreeSlug.mockResolvedValue("api-3");
    expect(await transferOwnership(OWNER, 30)).toEqual({ ok: true, formerOwnerSlug: "api-3" });
  });

  it("reports a slug race as a conflict rather than throwing", async () => {
    db.tx.mockRejectedValue(Object.assign(new Error("duplicate key"), { code: "23505" }));
    expect(await transferOwnership(OWNER, 30)).toEqual({ ok: false, code: "conflict" });
  });

  it("does not call it done when the guarded statements applied nothing", async () => {
    db.tx.mockResolvedValue(undefined);
    expect(await transferOwnership(OWNER, 30)).toEqual({ ok: false, code: "not-found" });
  });
});

describe("deleteProject", () => {
  it("reads the members before deleting, then tells each by name, not by a dead id", async () => {
    membershipsRepo.listByProject.mockResolvedValue([{ user_id: 2 }, { user_id: 3 }]);
    expect(await deleteProject(OWNER, 9)).toBe(true);

    expect(membershipsRepo.listByProject.mock.invocationCallOrder[0]).toBeLessThan(
      projectsRepo.remove.mock.invocationCallOrder[0],
    );
    expect(notificationsRepo.createStmt).toHaveBeenCalledTimes(2);
    expect(notificationsRepo.createStmt).toHaveBeenCalledWith({
      userId: 3,
      kind: "project_deleted",
      actorId: OWNER,
      detail: "API",
    });
  });

  it("deletes nothing it does not own", async () => {
    projectsRepo.ownedById.mockResolvedValue(undefined);
    expect(await deleteProject(OWNER, 9)).toBe(false);
    expect(projectsRepo.remove).not.toHaveBeenCalled();
  });

  it("sends no notices for a project nobody else was in", async () => {
    membershipsRepo.listByProject.mockResolvedValue([]);
    await deleteProject(OWNER, 9);
    expect(projectsRepo.remove).toHaveBeenCalledWith(OWNER, 9);
    expect(db.tx).not.toHaveBeenCalled();
  });
});

describe("removeMember", () => {
  it("tells the removed person after the removal", async () => {
    expect(await removeMember(OWNER, 30)).toBe(true);
    expect(membershipsRepo.removeOwned).toHaveBeenCalledWith(OWNER, 30);
    expect(notificationsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: HEIR, kind: "member_removed", projectId: 9 }),
    );
  });

  it("does nothing for a membership in somebody else's project", async () => {
    membershipsRepo.ownedById.mockResolvedValue(undefined);
    expect(await removeMember(OWNER, 30)).toBe(false);
    expect(membershipsRepo.removeOwned).not.toHaveBeenCalled();
  });
});
