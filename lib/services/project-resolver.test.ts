import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The resolver crashed in production on a row it was told could not exist.
 *
 * `withRootPath` promises projects that have a filesystem path, and the caller
 * asserted that with `!`. The query's condition and the column it projected
 * disagreed for shared projects, so a null arrived anyway — and because the
 * dereference happened inside a `.filter`, one such row did not degrade the
 * result, it threw out of `get_context` for the whole account.
 *
 * The repository is mocked because the failure is in the resolver's handling of
 * what it is handed, and that has to hold whatever any future query returns.
 */
const repo = vi.hoisted(() => ({
  bySlug: vi.fn(),
  byName: vi.fn(),
  listByName: vi.fn(),
  withRootPath: vi.fn(),
  withRepoUrl: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  nextFreeSlug: vi.fn(),
}));

const paths = vi.hoisted(() => ({
  listAll: vi.fn(),
  listFor: vi.fn(),
  add: vi.fn(),
}));

vi.mock("../repositories/projects", () => repo);
vi.mock("../repositories/project-paths", () => paths);

const { resolve, resolveOrCreate } = await import("./project-resolver");

const project = (id: number, root_path: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  slug: `p${id}`,
  name: `p${id}`,
  root_path,
  repo_url: null,
  user_id: 1,
  ...extra,
});

beforeEach(() => {
  // Call counts as well as implementations: two of these tests assert that the
  // path lookup was never reached, which a counter left over from the previous
  // test would quietly answer for them.
  vi.clearAllMocks();
  repo.bySlug.mockResolvedValue(undefined);
  repo.byName.mockResolvedValue(undefined);
  repo.listByName.mockResolvedValue([]);
  repo.list.mockResolvedValue([]);
  repo.withRootPath.mockResolvedValue([]);
  repo.withRepoUrl.mockResolvedValue([]);
  repo.nextFreeSlug.mockResolvedValue("fresh-slug");
  repo.create.mockImplementation((_userId, input) => ({ id: 99, ...input }));
  paths.listAll.mockResolvedValue([]);
  paths.listFor.mockResolvedValue([]);
});

describe("resolve by path", () => {
  it("skips a row with a null root_path instead of throwing", async () => {
    // Exactly the shape that took production down: a shared project whose
    // member row has no path of its own, beside a perfectly good match.
    repo.withRootPath.mockResolvedValue([
      project(1, null),
      project(2, "/Users/me/todox"),
    ]);

    await expect(resolve(1, "/Users/me/todox/lib")).resolves.toMatchObject({ id: 2 });
  });

  it("does not throw when every row has a null root_path", async () => {
    repo.withRootPath.mockResolvedValue([project(1, null), project(2, null)]);

    await expect(resolve(1, "/Users/me/todox")).resolves.toBeUndefined();
  });

  it("prefers the deepest root, so a nested repo beats its parent", async () => {
    repo.withRootPath.mockResolvedValue([
      project(1, "/Users/me"),
      project(2, "/Users/me/todox"),
      project(3, null),
    ]);

    await expect(resolve(1, "/Users/me/todox/lib/db")).resolves.toMatchObject({ id: 2 });
  });

  it("returns undefined when the path is inside none of them", async () => {
    repo.withRootPath.mockResolvedValue([project(1, "/Users/me/other")]);

    await expect(resolve(1, "/Users/me/todox")).resolves.toBeUndefined();
  });

  it("answers from the slug without ever touching the path list", async () => {
    repo.bySlug.mockResolvedValue(project(9, null));

    await expect(resolve(1, "todox")).resolves.toMatchObject({ id: 9 });
    expect(repo.withRootPath).not.toHaveBeenCalled();
  });

  it("falls through slug then name before trying paths", async () => {
    repo.byName.mockResolvedValue(project(8, null));

    await expect(resolve(1, "Todox")).resolves.toMatchObject({ id: 8 });
    expect(repo.withRootPath).not.toHaveBeenCalled();
  });

  /**
   * A second machine records its own path, and from then on the cheap match
   * works without the remote having to arrive on every call.
   */
  it("matches a path registered for a machine other than the first", async () => {
    repo.withRootPath.mockResolvedValue([project(2, "C:/Users/me/todox")]);
    paths.listAll.mockResolvedValue([
      { id: 1, project_id: 2, user_id: 1, path: "/Users/me/todox", created_at: "" },
    ]);

    await expect(resolve(1, "/Users/me/todox/lib")).resolves.toMatchObject({ id: 2 });
  });
});

/**
 * The bug this file's newer half exists for.
 *
 * A project used to be identified by one absolute path, so the same repository
 * opened on a second computer matched nothing, registered again, and came back
 * as `todox-2`. Half the log then lived under each.
 */
describe("the same repo, seen from a second machine", () => {
  it("matches on the remote before it ever looks at a path", async () => {
    repo.withRepoUrl.mockResolvedValue([
      project(5, "C:/Users/me/todox", { repo_url: "git@github.com:me/todox.git" }),
    ]);

    const found = await resolve(1, "/Users/me/todox", {
      repoUrl: "https://github.com/me/todox.git",
    });

    expect(found).toMatchObject({ id: 5 });
    // The two URL forms are the same repository, and the paths agree on nothing.
    expect(repo.withRootPath).not.toHaveBeenCalled();
  });

  it("adopts a project known only by paths from the other OS, and remembers the new one", async () => {
    repo.listByName.mockResolvedValue([project(7, "C:/Users/me/todox")]);
    repo.withRootPath.mockResolvedValue([project(7, "C:/Users/me/todox")]);

    const result = await resolveOrCreate(1, "/Users/me/todox");

    expect(result).toMatchObject({ project: { id: 7 }, created: false });
    expect(repo.create).not.toHaveBeenCalled();
    expect(paths.add).toHaveBeenCalledWith(1, 7, "/Users/me/todox");
  });

  it("records the remote on the adopted project when it had none", async () => {
    repo.listByName.mockResolvedValue([project(7, "C:/Users/me/todox")]);
    repo.withRootPath.mockResolvedValue([project(7, "C:/Users/me/todox")]);

    await resolveOrCreate(1, "/Users/me/todox", {
      repoUrl: "git@github.com:me/todox.git",
    });

    expect(repo.update).toHaveBeenCalledWith(1, 7, {
      repo_url: "git@github.com:me/todox.git",
    });
  });

  /**
   * The line this heuristic must not cross. `~/work/api` and `~/personal/api`
   * are two repositories that happen to share a folder name; fusing their logs
   * is worse than the duplicate, so the duplicate is created -- loudly.
   */
  it("does not fuse two same-named repos on one machine, and says why", async () => {
    repo.listByName.mockResolvedValue([project(7, "/Users/me/work/api")]);
    repo.withRootPath.mockResolvedValue([project(7, "/Users/me/work/api")]);

    const result = await resolveOrCreate(1, "/Users/me/personal/api");

    expect(result.created).toBe(true);
    expect(result.warning).toMatch(/merge_projects/);
    expect(paths.add).not.toHaveBeenCalled();
  });

  /** A name collision alone is not evidence; a project with no path is not a machine. */
  it("does not adopt a project that has no path at all", async () => {
    repo.listByName.mockResolvedValue([project(7, null)]);

    const result = await resolveOrCreate(1, "/Users/me/todox");

    expect(result.created).toBe(true);
    expect(repo.create).toHaveBeenCalled();
  });

  it("registers normally when the name is new", async () => {
    const result = await resolveOrCreate(1, "/Users/me/brand-new");

    expect(result.created).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(repo.create).toHaveBeenCalledWith(1, {
      name: "brand-new",
      slug: "fresh-slug",
      root_path: "/Users/me/brand-new",
      repo_url: null,
    });
  });
});
