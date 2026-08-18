import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server Actions are a public endpoint.
 *
 * Anyone with an account can post to one with any id they like, so the id in
 * the form body proves nothing. Every action that takes one has to ask
 * `lib/services/ownership.ts` whether the row is theirs, and has to ask
 * *before* it writes — an ownership check that runs after the mutation is a
 * log line, not a guard.
 *
 * Nothing under `app/` had a test until the vitest alias landed, and this is
 * the file that surface most needed.
 */

const USER = { id: 7, email: "a@b.c", email_verified_at: "2026-01-01" };

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  consume: vi.fn(),
  assertTask: vi.fn(),
  assertEntry: vi.fn(),
  assertRef: vi.fn(),
  assertProject: vi.fn(),
  assertContext: vi.fn(),
  entriesRemove: vi.fn(),
  refsUnlink: vi.fn(),
  refsAcceptSeen: vi.fn(),
  contextsRemove: vi.fn(),
  taskUpdate: vi.fn(),
  sharingSetSharing: vi.fn(),
  sharingRotate: vi.fn(),
  projectsUpdate: vi.fn(),
  // Typed with its arguments: the assertions below read `calls[0][1]`, and a
  // `vi.fn()` with no signature has an empty tuple there rather than a value.
  projectsCreate: vi.fn(async (..._args: unknown[]) => ({ id: 1, slug: "todox" })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn(), get: vi.fn() }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/session", () => ({
  requireUser: mocks.requireUser,
  setSessionCookie: vi.fn(),
}));
vi.mock("@/lib/lang", () => ({ LANG_COOKIE: "lang", getLang: async () => "en" }));
vi.mock("@/lib/services/rate-limit", () => ({ consume: mocks.consume }));
vi.mock("@/lib/services/ownership", () => ({
  assertTask: mocks.assertTask,
  assertEntry: mocks.assertEntry,
  assertRef: mocks.assertRef,
  assertProject: mocks.assertProject,
  assertContext: mocks.assertContext,
}));
vi.mock("@/lib/repositories/entries", () => ({ remove: mocks.entriesRemove }));
vi.mock("@/lib/repositories/refs", () => ({
  unlink: mocks.refsUnlink,
  acceptSeen: mocks.refsAcceptSeen,
  link: vi.fn(),
}));
vi.mock("@/lib/repositories/contexts", () => ({ remove: mocks.contextsRemove, create: vi.fn() }));
vi.mock("@/lib/repositories/projects", () => ({
  update: mocks.projectsUpdate,
  bySlug: vi.fn(),
  byId: vi.fn(),
  create: mocks.projectsCreate,
  remove: vi.fn(),
  nextFreeSlug: vi.fn(),
}));
vi.mock("@/lib/repositories/project-invitations", () => ({ revokeOwned: vi.fn() }));
vi.mock("@/lib/services/task-service", () => ({
  update: mocks.taskUpdate,
  create: vi.fn(),
  addEntry: vi.fn(),
}));
vi.mock("@/lib/services/sharing", () => ({
  setSharing: mocks.sharingSetSharing,
  rotate: mocks.sharingRotate,
}));
vi.mock("@/lib/services/collaboration", () => ({ removeMember: vi.fn() }));
vi.mock("@/lib/services/notifications", () => ({ markAllRead: vi.fn() }));
vi.mock("@/lib/services/project-invitations", () => ({
  invite: vi.fn(),
  accept: vi.fn(),
  acceptWithNewAccount: vi.fn(),
}));
vi.mock("@/lib/services/auth", () => ({ issueSession: vi.fn() }));

const actions = await import("./actions");

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

class Denied extends Error {
  constructor() {
    super("task #1 does not exist or is not yours");
    this.name = "NotYours";
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(USER);
  mocks.consume.mockResolvedValue({ allowed: true });
});

/**
 * One row per action that mutates something behind an id from the form. Each
 * names the guard it must ask and the write it must not reach without one.
 */
const GUARDED = [
  {
    action: "deleteEntryAction",
    field: "entry_id",
    guard: mocks.assertEntry,
    write: mocks.entriesRemove,
  },
  { action: "unlinkRefAction", field: "ref_id", guard: mocks.assertRef, write: mocks.refsUnlink },
  {
    action: "acceptRefAction",
    field: "ref_id",
    guard: mocks.assertRef,
    write: mocks.refsAcceptSeen,
  },
  {
    action: "deleteContextAction",
    field: "context_id",
    guard: mocks.assertContext,
    write: mocks.contextsRemove,
  },
  { action: "setStatusAction", field: "task_id", guard: mocks.assertTask, write: mocks.taskUpdate },
  {
    action: "updateTaskAction",
    field: "task_id",
    guard: mocks.assertTask,
    write: mocks.taskUpdate,
  },
  {
    action: "updateProjectAction",
    field: "id",
    guard: mocks.assertProject,
    write: mocks.projectsUpdate,
  },
  {
    action: "rotateShareAction",
    field: "project_id",
    guard: mocks.assertProject,
    write: mocks.sharingRotate,
  },
  {
    action: "setSharingAction",
    field: "project_id",
    guard: mocks.assertProject,
    write: mocks.sharingSetSharing,
  },
] as const;

describe("actions that take an id from the form", () => {
  for (const { action, field, guard, write } of GUARDED) {
    describe(action, () => {
      const run = () =>
        (actions as unknown as Record<string, (fd: FormData) => Promise<unknown>>)[action](
          form({ [field]: "1", status: "doing", enabled: "1", title: "t", body: "b" }),
        );

      it("checks ownership against the session user, not the form", async () => {
        // The id is the caller's to choose; the account is not.
        await run();
        expect(guard).toHaveBeenCalledWith(USER.id, 1);
      });

      it("does not write when the check refuses", async () => {
        guard.mockRejectedValueOnce(new Denied());

        await expect(run()).rejects.toThrow(/not yours/);
        expect(write).not.toHaveBeenCalled();
      });

      it("checks before it writes, not after", async () => {
        const order: string[] = [];
        guard.mockImplementationOnce(async () => void order.push("guard"));
        write.mockImplementationOnce(async () => void order.push("write"));

        await run();

        expect(order).toEqual(["guard", "write"]);
      });
    });
  }
});

/**
 * A source-level sweep, so an action added next week cannot skip the boundary
 * just because nobody wrote it a test. The rule this encodes is
 * `CONTRIBUTING.md`'s: ownership is checked in exactly one place, and every
 * write path proves it before touching a row.
 */
describe("every exported action", () => {
  const source = readFileSync(
    path.resolve(fileURLToPath(import.meta.url), "..", "actions.ts"),
    "utf8",
  );

  /** Bodies of the exported actions, by name. */
  const bodies = new Map<string, string>();
  const pattern = /export async function (\w+)\s*\([\s\S]*?\n\}/g;
  for (const match of source.matchAll(pattern)) bodies.set(match[1]!, match[0]!);

  /**
   * The two that legitimately run without an account, and why.
   * `setLangAction` only sets a cookie; `acceptNewAccountInviteAction` is how
   * somebody without an account yet redeems an invitation — its authority is
   * the token in the link, which `acceptWithNewAccount` checks.
   */
  const NO_ACCOUNT = new Set(["setLangAction", "acceptNewAccountInviteAction"]);

  it("finds the actions at all, so a rename cannot empty this suite", () => {
    expect(bodies.size).toBeGreaterThan(15);
    expect([...bodies.keys()]).toContain("deleteEntryAction");
  });

  for (const [name, body] of bodies) {
    if (NO_ACCOUNT.has(name)) continue;

    it(`${name} resolves the account from the session, and counts the write`, () => {
      // `writingUser()` is `requireUser()` plus the meter. Naming only the
      // helper is what keeps the two from drifting apart: an action that
      // reaches for `requireUser()` directly is authenticated and unmetered,
      // which is exactly the state this whole surface was in.
      expect(body).toContain("writingUser()");
      expect(body).not.toContain("requireUser()");
    });

    it(`${name} passes that account into whatever it calls`, () => {
      // Either an ownership assert, or a service/repository call that takes the
      // user id and does the scoping in its own query. What must never happen
      // is an id from the form reaching a write with no account beside it.
      expect(body).toMatch(/user\.id/);
    });
  }
});

/**
 * The web write path stores a project the same way the agent surface does.
 *
 * `lib/services/rpc.ts` normalises `root_path` and scrubs `repo_url` before
 * either reaches the row; these two actions did neither. That is not cosmetic:
 * resolution matches on the normalised form, so a path saved here with
 * backslashes is a path an agent arriving with the same `cwd` will not match --
 * and a project that fails to resolve is registered a second time rather than
 * reported. Splitting one repository in two is the failure this codebase
 * already has a `merge_projects` method to undo.
 */
describe("a project saved from the web is stored the way an agent would store it", () => {
  const WINDOWS = "C:\\Users\\Furkan\\todox";

  it("updateProjectAction folds the separators", async () => {
    await actions.updateProjectAction(form({ id: "1", name: "todox", root_path: WINDOWS }));
    const patch = mocks.projectsUpdate.mock.calls[0]![2] as { root_path: string };
    expect(patch.root_path).toBe("C:/Users/Furkan/todox");
  });

  it("createProjectAction folds them too", async () => {
    await actions.createProjectAction(form({ name: "todox", root_path: WINDOWS }));
    const created = mocks.projectsCreate.mock.calls[0]![1] as { root_path: string };
    expect(created.root_path).toBe("C:/Users/Furkan/todox");
  });

  it("updateProjectAction keeps the remote, which is the cross-machine identity", async () => {
    // Displayed on the project page and, until now, settable only by an agent.
    await actions.updateProjectAction(
      form({ id: "1", name: "todox", repo_url: "git@github.com:me/todox.git" }),
    );
    const patch = mocks.projectsUpdate.mock.calls[0]![2] as { repo_url: string | null };
    expect(patch.repo_url).toBeTruthy();
  });

  it("stores an empty path and an empty remote as null, not as an empty string", async () => {
    // `repoKey` folds a remote to an identity; an empty string is a value that
    // would compare equal across unrelated projects.
    await actions.updateProjectAction(form({ id: "1", name: "todox" }));
    const patch = mocks.projectsUpdate.mock.calls[0]![2] as Record<string, unknown>;
    expect(patch.root_path).toBeNull();
    expect(patch.repo_url).toBeNull();
  });
});

describe("the ceiling on writes from a browser", () => {
  /**
   * The agent surface has been metered per token since it existed and this one
   * was not metered at all — a session cookie is every bit as scriptable as a
   * bearer token, so the same account could write as fast as it could post.
   */
  it("counts the write against the account, not the form", async () => {
    await actions.createProjectAction(form({ name: "todox" }));
    expect(mocks.consume).toHaveBeenCalledWith("webWritePerUser", String(USER.id));
  });

  it("counts before it writes, so a refusal costs nothing downstream", async () => {
    mocks.consume.mockResolvedValue({ allowed: false, retryAfterSec: 300 });
    await expect(actions.createProjectAction(form({ name: "todox" }))).rejects.toThrow(
      /too many writes/,
    );
    expect(mocks.projectsCreate).not.toHaveBeenCalled();
  });

  it("refuses loudly rather than returning as though it had worked", async () => {
    // The failure this codebase keeps finding: the caller is told nothing and
    // the work simply did not happen. A form that settles with no row and no
    // message is indistinguishable from one that succeeded.
    mocks.consume.mockResolvedValue({ allowed: false, retryAfterSec: 300 });
    await expect(actions.deleteEntryAction(form({ entry_id: "1" }))).rejects.toThrow();
    expect(mocks.entriesRemove).not.toHaveBeenCalled();
  });

});
