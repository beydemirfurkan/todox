import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A merge is seven tables agreeing, and the order is the part that rots
 * silently: every statement below still "works" if the delete runs first, it
 * just takes the rows with it. So these tests assert the shape of what is
 * handed to `tx()`, not what a database did with it.
 */
const db = vi.hoisted(() => ({ tx: vi.fn(), one: vi.fn(), all: vi.fn(), run: vi.fn() }));
const resolver = vi.hoisted(() => ({ mustResolve: vi.fn() }));
const ownership = vi.hoisted(() => ({ assertProject: vi.fn() }));
const tasks = vi.hoisted(() => ({ counts: vi.fn(), reassignStmt: vi.fn() }));
const contexts = vi.hoisted(() => ({ listByProject: vi.fn(), reassignStmt: vi.fn() }));
const notifications = vi.hoisted(() => ({ reassignStmt: vi.fn() }));
const projectPaths = vi.hoisted(() => ({
  listFor: vi.fn(),
  reassignStmt: vi.fn(),
  addStmt: vi.fn(),
}));
const projects = vi.hoisted(() => ({ removeStmt: vi.fn(), fillRepoUrlStmt: vi.fn() }));
const memberships = vi.hoisted(() => ({ listByProject: vi.fn() }));
const invitations = vi.hoisted(() => ({ listByProject: vi.fn() }));

vi.mock("../db/client", () => db);
vi.mock("./project-resolver", () => resolver);
vi.mock("./ownership", () => ownership);
vi.mock("../repositories/tasks", () => tasks);
vi.mock("../repositories/contexts", () => contexts);
vi.mock("../repositories/notifications", () => notifications);
vi.mock("../repositories/project-paths", () => projectPaths);
vi.mock("../repositories/projects", () => projects);
vi.mock("../repositories/project-memberships", () => memberships);
vi.mock("../repositories/project-invitations", () => invitations);

const { merge } = await import("./project-merge");

const project = (id: number, slug: string, extra: Record<string, unknown> = {}) => ({
  id,
  slug,
  name: slug,
  root_path: `/Users/me/${slug}`,
  repo_url: null,
  user_id: 1,
  ...extra,
});

/** Every statement builder answers with a label, so order is readable. */
const label = (name: string) => vi.fn(() => ({ text: name, params: [] }));

beforeEach(() => {
  vi.clearAllMocks();
  resolver.mustResolve.mockImplementation(async (_u: number, ref: string) =>
    ref === "todox-2" ? project(2, "todox-2") : project(1, "todox"),
  );
  ownership.assertProject.mockResolvedValue(undefined);
  tasks.counts.mockResolvedValue({ todo: 2, done: 1 });
  contexts.listByProject.mockResolvedValue([{ id: 1 }, { id: 2 }]);
  projectPaths.listFor.mockResolvedValue([]);
  memberships.listByProject.mockResolvedValue([]);
  invitations.listByProject.mockResolvedValue([]);
  db.tx.mockResolvedValue([]);

  tasks.reassignStmt = label("tasks");
  contexts.reassignStmt = label("contexts");
  notifications.reassignStmt = label("notifications");
  projectPaths.reassignStmt = label("paths");
  projectPaths.addStmt = label("adopt-path");
  projects.fillRepoUrlStmt = label("fill-repo-url");
  projects.removeStmt = label("delete-project");
});

const run = () => merge(1, { from: "todox-2", into: "todox", confirm: "todox-2" });

describe("what the merge refuses", () => {
  /**
   * The catastrophic one. Every move becomes a no-op and the delete at the end
   * takes the project and everything under it.
   */
  it("will not merge a project into itself, and never opens a transaction", async () => {
    resolver.mustResolve.mockResolvedValue(project(1, "todox"));

    await expect(
      merge(1, { from: "todox", into: "todox", confirm: "todox" }),
    ).rejects.toThrow(/same project/);
    expect(db.tx).not.toHaveBeenCalled();
  });

  it("requires the confirmation to be the slug of the project going away", async () => {
    await expect(
      merge(1, { from: "todox-2", into: "todox", confirm: "todox" }),
    ).rejects.toThrow(/todox-2/);
    expect(db.tx).not.toHaveBeenCalled();
  });

  it("accepts a confirmation in any case, like delete_project", async () => {
    await expect(
      merge(1, { from: "todox-2", into: "todox", confirm: "  TODOX-2 " }),
    ).resolves.toBeTruthy();
  });

  /**
   * Ownership, not access. A collaborator merging away the owner's project
   * would be a privilege escalation dressed up as tidying.
   */
  it("asserts ownership of both sides before touching anything", async () => {
    await run();
    expect(ownership.assertProject).toHaveBeenCalledWith(1, 2);
    expect(ownership.assertProject).toHaveBeenCalledWith(1, 1);
  });

  it("refuses a project with collaborators rather than half-moving them", async () => {
    memberships.listByProject.mockResolvedValue([{ id: 5 }]);

    await expect(run()).rejects.toThrow(/collaborators or pending invitations/);
    expect(db.tx).not.toHaveBeenCalled();
  });

  it("refuses a project with a pending invitation for the same reason", async () => {
    invitations.listByProject.mockResolvedValue([{ id: 9 }]);

    await expect(run()).rejects.toThrow(/collaborators or pending invitations/);
    expect(db.tx).not.toHaveBeenCalled();
  });
});

describe("the transaction", () => {
  const statements = () => db.tx.mock.calls[0][0].map((s: { text: string }) => s.text);

  it("moves every table before deleting the project", async () => {
    await run();
    const order = statements();

    expect(order).toEqual([
      "tasks",
      "contexts",
      "notifications",
      "paths",
      "adopt-path",
      "delete-project",
    ]);
  });

  /**
   * The absorbed project's own `root_path` lives in the row about to be
   * deleted. Without this it is the one path nothing else records, and the
   * second machine stops resolving the moment the merge lands -- which is the
   * exact bug the merge exists to fix.
   */
  it("keeps the absorbed project's path by adopting it onto the survivor", async () => {
    await run();
    expect(projectPaths.addStmt).toHaveBeenCalledWith(1, 1, "/Users/me/todox-2");
  });

  it("carries the remote over when the survivor has none", async () => {
    resolver.mustResolve.mockImplementation(async (_u: number, ref: string) =>
      ref === "todox-2"
        ? project(2, "todox-2", { repo_url: "git@github.com:me/todox.git" })
        : project(1, "todox"),
    );

    await run();
    expect(projects.fillRepoUrlStmt).toHaveBeenCalledWith(1, 1, "git@github.com:me/todox.git");
    expect(statements()).toContain("fill-repo-url");
  });

  it("does not touch the remote when the absorbed project had none", async () => {
    await run();
    expect(projects.fillRepoUrlStmt).not.toHaveBeenCalled();
  });

  it("reports what actually moved", async () => {
    projectPaths.listFor.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    await expect(run()).resolves.toMatchObject({
      merged: "todox-2",
      into: "todox",
      tasks_moved: 3,
      contexts_moved: 2,
      paths_moved: 3,
    });
  });
});
