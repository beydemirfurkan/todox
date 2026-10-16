import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `create_project` names a project deliberately, so it skips the reading order
 * auto-registration follows -- and it used to skip the existence check with it.
 * An agent told to "name one deliberately" from a scratch directory passed the
 * repository's own path and remote, and got a `-2` twin of a project it already
 * had.
 */

const usage = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("../repositories/tool-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../repositories/tool-usage")>()),
  ...usage,
}));

const projects = vi.hoisted(() => ({
  withRootPath: vi.fn(),
  withRepoUrl: vi.fn(),
  create: vi.fn(),
  nextFreeSlug: vi.fn(),
}));
vi.mock("../repositories/projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../repositories/projects")>()),
  ...projects,
}));

const paths = vi.hoisted(() => ({ listAll: vi.fn() }));
vi.mock("../repositories/project-paths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../repositories/project-paths")>()),
  ...paths,
}));

const { invoke } = await import("./rpc");

const CTX = { userId: 7 };

const todox = {
  id: 3,
  slug: "todox",
  name: "todox",
  root_path: "C:/Users/me/todox",
  repo_url: "https://github.com/me/todox",
  user_id: 7,
};

beforeEach(() => {
  vi.clearAllMocks();
  usage.record.mockResolvedValue(undefined);
  projects.withRootPath.mockResolvedValue([todox]);
  projects.withRepoUrl.mockResolvedValue([todox]);
  projects.nextFreeSlug.mockResolvedValue("todox-2");
  projects.create.mockImplementation((_userId, input) => ({ id: 99, ...input }));
  paths.listAll.mockResolvedValue([]);
});

describe("createProject", () => {
  it("returns the project that already has this path instead of a twin", async () => {
    const result = await invoke(CTX, "createProject", {
      name: "todox",
      root_path: String.raw`c:\users\me\todox`,
    });

    expect(result).toMatchObject({ id: 3, created: false });
    expect(result).toHaveProperty("warning");
    expect(projects.create).not.toHaveBeenCalled();
  });

  it("returns the project that already has this remote, in another clone form", async () => {
    const result = await invoke(CTX, "createProject", {
      name: "todox-laptop",
      repo_url: "git@github.com:me/todox.git",
    });

    expect(result).toMatchObject({ id: 3, created: false });
    expect(projects.create).not.toHaveBeenCalled();
  });

  it("still creates a package inside a known repository: containment is not identity", async () => {
    const result = await invoke(CTX, "createProject", {
      name: "web",
      root_path: "C:/Users/me/todox/packages/web",
    });

    expect(result).toMatchObject({ id: 99, created: true, slug: "todox-2" });
  });

  it("creates a project nothing matches", async () => {
    const result = await invoke(CTX, "createProject", { name: "notes" });

    expect(result).toMatchObject({ id: 99, created: true });
  });
});
