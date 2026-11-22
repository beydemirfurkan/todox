import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The public read-only link. What is pinned is the lifetime of the token: a
 * link handed out stays valid until it is turned off or rotated, and nothing
 * else replaces it behind the owner's back.
 */
const projectsRepo = vi.hoisted(() => ({
  byId: vi.fn(),
  byShareToken: vi.fn(),
  setShare: vi.fn(),
  freshShareToken: vi.fn(() => "fresh-token"),
}));
vi.mock("../repositories/projects", () => projectsRepo);

const { rotate, setSharing } = await import("./sharing");

beforeEach(() => {
  vi.clearAllMocks();
  projectsRepo.byId.mockResolvedValue({ id: 9, share_token: null, share_log: 0 });
});

describe("setSharing", () => {
  it("mints a token the first time it is turned on", async () => {
    await setSharing(1, 9, { enabled: true });
    expect(projectsRepo.setShare).toHaveBeenCalledWith(1, 9, "fresh-token", false);
  });

  it("keeps the link already handed out when only the log toggle changes", async () => {
    projectsRepo.byId.mockResolvedValue({ id: 9, share_token: "old-token", share_log: 0 });
    await setSharing(1, 9, { enabled: true, includeLog: true });
    expect(projectsRepo.setShare).toHaveBeenCalledWith(1, 9, "old-token", true);
    expect(projectsRepo.freshShareToken).not.toHaveBeenCalled();
  });

  it("clears the token when turned off, so the old link stops working", async () => {
    await setSharing(1, 9, { enabled: false });
    expect(projectsRepo.setShare).toHaveBeenCalledWith(1, 9, null, false);
  });

  it("writes nothing for a project the caller cannot see", async () => {
    projectsRepo.byId.mockResolvedValue(undefined);
    expect(await setSharing(1, 9, { enabled: true })).toBeUndefined();
    expect(projectsRepo.setShare).not.toHaveBeenCalled();
  });
});

describe("rotate", () => {
  it("replaces the token and keeps the log setting", async () => {
    projectsRepo.byId.mockResolvedValue({ id: 9, share_token: "old-token", share_log: 1 });
    await rotate(1, 9);
    expect(projectsRepo.setShare).toHaveBeenCalledWith(1, 9, "fresh-token", true);
  });

  it("does not turn sharing on for a project that was not shared", async () => {
    await rotate(1, 9);
    expect(projectsRepo.setShare).not.toHaveBeenCalled();
  });
});
