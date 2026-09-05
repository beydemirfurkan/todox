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

/**
 * The evidence a real caller carries: the stdio process fills `repo_root` from
 * a root marker, and `REMOTE_NOTE` asks a hosted client for it. Registration
 * refuses without one, so a test that means to register has to say so -- which
 * is the point, and why this is spelled out rather than defaulted.
 *
 * The same path the call is about, because that is what a caller standing in
 * the repository root actually sends, and because `repo_root` is what the
 * project is named and rooted from.
 */
const at = (path: string) => ({ repoRoot: path });

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

    const result = await resolveOrCreate(1, "/Users/me/todox", at("/Users/me/todox"));

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

    const result = await resolveOrCreate(1, "/Users/me/personal/api", at("/Users/me/personal/api"));

    expect(result.created).toBe(true);
    expect(result.warning).toMatch(/merge_projects/);
    expect(paths.add).not.toHaveBeenCalled();
  });

  /** A name collision alone is not evidence; a project with no path is not a machine. */
  it("does not adopt a project that has no path at all", async () => {
    repo.listByName.mockResolvedValue([project(7, null)]);

    const result = await resolveOrCreate(1, "/Users/me/todox", at("/Users/me/todox"));

    expect(result.created).toBe(true);
    expect(repo.create).toHaveBeenCalled();
  });

  it("registers normally when the name is new", async () => {
    const result = await resolveOrCreate(1, "/Users/me/brand-new", at("/Users/me/brand-new"));

    expect(result.created).toBe(true);
    // Not flagged as a duplicate, which is what this describe block is about.
    // It does carry the no-remote warning -- a different thing, asserted below.
    expect(result.warning ?? "").not.toContain("already have a project");
    expect(repo.create).toHaveBeenCalledWith(1, {
      name: "brand-new",
      slug: "fresh-slug",
      root_path: "/Users/me/brand-new",
      repo_url: null,
    });
  });
});

/**
 * The condition that is invisible until the day it costs something.
 *
 * A project with no `repo_url` is identified by its path, so `adoptable()`
 * will only ever match it across OS families -- two Macs, or two Linux boxes,
 * each register the same repository again and the history splits. 44 of 58
 * projects in production are in that state, and nothing said so.
 *
 * Said at registration and nowhere else. The condition holds for most projects
 * most of the time, so repeating it in every briefing would turn it into
 * wallpaper; the moment it is news is the moment the project first appears.
 */
describe("a project registered without a remote", () => {
  it("says so, and says what it costs", async () => {
    const { warning } = await resolveOrCreate(1, "/Users/me/no-origin", at("/Users/me/no-origin"));

    expect(warning).toContain("no git remote");
    expect(warning).toContain("second computer");
  });

  it("says nothing when there is a remote to identify it by", async () => {
    const { warning } = await resolveOrCreate(1, "/Users/me/has-origin", {
      repoUrl: "git@github.com:me/has-origin.git",
    });

    expect(warning).toBeUndefined();
  });

  /**
   * The duplicate branch already explains `repo_url` in more detail, and two
   * warnings on one call is how an agent learns to skim them.
   */
  it("does not stack with the duplicate warning", async () => {
    repo.listByName.mockResolvedValue([project(7, "/Users/me/elsewhere/dup")]);

    const { warning } = await resolveOrCreate(1, "/Users/me/dup", at("/Users/me/dup"));

    expect(warning).toContain("already have a project");
    expect(warning).not.toContain("no git remote");
  });
});

/**
 * A project is a repository, not a path -- enforced at the one place that used
 * to take a path at its word.
 *
 * Measured on production 2026-09-04, and the numbers are why this exists at
 * all: twelve of one account's twenty-one projects were its client's per-prompt
 * scratch directories, plus the client's own installation and its binary cache.
 * Four of the twelve hold real tasks, so this is not a tidiness problem -- it
 * is work filed in a dated prompt folder nobody will open again.
 */
describe("registering needs evidence that the path is a repository", () => {
  it("refuses a directory nothing says is a checkout", async () => {
    await expect(
      resolveOrCreate(1, "C:/Users/me/Documents/Codex/2026-09-02/yol"),
    ).rejects.toThrow(/no repository at/);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("accepts a root marker as evidence, with no remote at all", async () => {
    // A local-only checkout is a real repository. Requiring the remote instead
    // would have refused `airflow-dags`, which has seven tasks and no origin.
    const { created } = await resolveOrCreate(1, "/Users/me/local-only", {
      repoRoot: "/Users/me/local-only",
    });
    expect(created).toBe(true);
  });

  it("accepts a remote as evidence, with no root marker", async () => {
    // The hosted transport cannot look for a marker; a client that answered
    // `git remote get-url origin` has still proved the point.
    const { created } = await resolveOrCreate(1, "/Users/me/hosted", {
      repoUrl: "git@github.com:me/hosted.git",
    });
    expect(created).toBe(true);
  });

  /**
   * The error is read by a model mid-tool-call, so it has to be actionable. An
   * error that only says no teaches an agent to stop calling the tool, which
   * costs more than the junk it prevents.
   */
  it("says what to send instead, by name", async () => {
    const err = await resolveOrCreate(1, "/scratch/thing").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    for (const clue of ["repo_root", "repo_url", "create_project", "project"])
      expect((err as Error).message).toContain(clue);
  });

  /**
   * MUTATION CHECK. `||` instead of `&&` in the guard reads identically and
   * refuses every hosted caller that sends only a remote -- which is the one
   * evidence the hosted transport can actually produce, so the whole surface
   * would stop registering anything while the unit above still passed.
   */
  it("takes either piece of evidence, not both", async () => {
    await expect(
      resolveOrCreate(1, "/Users/me/one", { repoUrl: "git@github.com:me/one.git" }),
    ).resolves.toMatchObject({ created: true });
    await expect(
      resolveOrCreate(1, "/Users/me/two", { repoRoot: "/Users/me/two" }),
    ).resolves.toMatchObject({ created: true });
  });

  it("still resolves a path it already knows, with no evidence at all", async () => {
    // The gate is on CREATION. An agent working in a directory todox has seen
    // before must not start needing to prove it again.
    repo.withRootPath.mockResolvedValue([project(9, "/Users/me/known")]);
    const found = await resolveOrCreate(1, "/Users/me/known/src/app.ts");
    expect(found.created).toBe(false);
    expect(found.project.id).toBe(9);
  });
});
