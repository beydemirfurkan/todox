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
  withRootPath: vi.fn(),
  list: vi.fn(),
}));

vi.mock("../repositories/projects", () => repo);

const { resolve } = await import("./project-resolver");

const project = (id: number, root_path: string | null) => ({
  id,
  slug: `p${id}`,
  name: `p${id}`,
  root_path,
  user_id: 1,
});

beforeEach(() => {
  // Call counts as well as implementations: two of these tests assert that the
  // path lookup was never reached, which a counter left over from the previous
  // test would quietly answer for them.
  vi.clearAllMocks();
  repo.bySlug.mockResolvedValue(undefined);
  repo.byName.mockResolvedValue(undefined);
  repo.list.mockResolvedValue([]);
  repo.withRootPath.mockResolvedValue([]);
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
});
