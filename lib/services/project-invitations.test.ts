import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who is allowed to accept an invitation, and on the strength of what.
 *
 * The comment above `accept` describes a privilege escalation that was fixed
 * here and never given a regression test. The id on its own used to be enough:
 * an account may claim any address and keep working unverified, the account
 * page listed every pending invitation for the address it claimed, and
 * accepting one both granted write access to somebody else's project and
 * marked the claimed address verified -- which is the gate on publishing a
 * public share link. Sequential ids meant seeing the list was not even
 * necessary.
 *
 * Two routes in, then, and each carries its own proof: a token, which is bound
 * to one address and was mailed to it; or an id plus an address the account has
 * already verified through a link sent to that same inbox. Nothing else opens
 * the door, and the tests below are written as attempts on it.
 */
const mocks = vi.hoisted(() => ({
  tx: vi.fn(),
  all: vi.fn(async () => []),
  one: vi.fn(async () => undefined),
  run: vi.fn(async () => 0),
  byToken: vi.fn(),
  byIdForEmail: vi.fn(),
  acceptStmt: vi.fn(() => ({ text: "accept", params: [] })),
  createMembershipStmt: vi.fn(() => ({ text: "membership", params: [] })),
  markEmailVerifiedStmt: vi.fn(() => ({ text: "verified", params: [] })),
  createNotificationStmt: vi.fn(() => ({ text: "notify", params: [] })),
  listByUser: vi.fn(async () => []),
  nextFreeSlug: vi.fn(async () => "shared"),
  byEmail: vi.fn(),
  byId: vi.fn(async () => ({ id: 9, name: "Owner", email: "owner@example.com" })),
  send: vi.fn(),
}));

/**
 * Only the functions that reach Postgres. Replacing the module wholesale also
 * removes `setClause` and friends, and a helper dying on a TypeError partway
 * through reads here as a refusal -- which is the answer half these tests are
 * checking for.
 */
vi.mock("../db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client")>()),
  tx: mocks.tx,
  all: mocks.all,
  one: mocks.one,
  run: mocks.run,
}));
vi.mock("../repositories/project-invitations", () => ({
  byToken: mocks.byToken,
  byIdForEmail: mocks.byIdForEmail,
  acceptStmt: mocks.acceptStmt,
  acceptWithNewUser: vi.fn(),
}));
vi.mock("../repositories/project-memberships", () => ({
  createForAcceptedInvitationStmt: mocks.createMembershipStmt,
  listByUser: mocks.listByUser,
  nextFreeSlug: mocks.nextFreeSlug,
}));
vi.mock("../repositories/users", () => ({
  markEmailVerifiedStmt: mocks.markEmailVerifiedStmt,
  byEmail: mocks.byEmail,
  byId: mocks.byId,
}));
vi.mock("../repositories/notifications", () => ({
  createForAcceptedInvitationStmt: mocks.createNotificationStmt,
}));
vi.mock("./mailer", () => ({ send: mocks.send }));

const service = await import("./project-invitations");

const INVITED = "invitee@example.com";
const INVITATION = {
  id: 5,
  email: INVITED,
  project_id: 2,
  project_slug: "shared",
  project_name: "Shared",
  owner_id: 9,
};

/** The labels of the statements handed to `tx`. */
const statementsSent = () =>
  (mocks.tx.mock.calls[0]?.[0] as { text: string }[] | undefined)?.map((s) => s.text) ?? [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.byToken.mockResolvedValue(INVITATION);
  mocks.byIdForEmail.mockResolvedValue(INVITATION);
  mocks.tx.mockResolvedValue([[{ id: 5 }], [{ access_slug: "shared" }]]);
  mocks.all.mockResolvedValue([]);
  mocks.one.mockResolvedValue(undefined);
});

describe("accepting with the id alone", () => {
  const byId = (over: Record<string, unknown> = {}) =>
    service.accept({
      userId: 3,
      email: INVITED,
      invitationId: INVITATION.id,
      emailVerified: true,
      lang: "en",
      ...over,
    });

  it("works when the address is verified", async () => {
    await expect(byId()).resolves.toBe("shared");
  });

  it("is refused when the address is not verified", async () => {
    // The escalation. An unverified address is a claim, not a proof, and this
    // route has nothing else behind it.
    await expect(byId({ emailVerified: false })).resolves.toBeNull();
    expect(mocks.tx).not.toHaveBeenCalled();
  });

  it("is refused when nothing says the address is verified at all", async () => {
    await expect(byId({ emailVerified: undefined })).resolves.toBeNull();
    expect(mocks.tx).not.toHaveBeenCalled();
  });

  it("does not look the invitation up before deciding that", async () => {
    // Sequential ids: a refusal that still queries is a refusal that can be
    // timed, and there is no reason to ask.
    await byId({ emailVerified: false });
    expect(mocks.byIdForEmail).not.toHaveBeenCalled();
  });

  it("never marks an address verified on this route", async () => {
    // Accepting from the account list proves nothing about the inbox -- and
    // this is the gate on publishing a public share link.
    await byId();
    expect(statementsSent()).not.toContain("verified");
  });
});

describe("accepting with the token", () => {
  const byToken = (over: Record<string, unknown> = {}) =>
    service.accept({ userId: 3, email: INVITED, token: "t", lang: "en", ...over });

  it("works without the address having been verified first", async () => {
    // The token was mailed to that address; following it is the proof.
    await expect(byToken({ emailVerified: false })).resolves.toBe("shared");
  });

  it("marks the address verified, because reaching the link proved the inbox", async () => {
    await byToken();
    expect(statementsSent()).toContain("verified");
  });

  it("is refused when the account's address is not the invited one", async () => {
    // Otherwise a forwarded link is a way into somebody else's project.
    await expect(byToken({ email: "someone-else@example.com" })).resolves.toBeNull();
    expect(mocks.tx).not.toHaveBeenCalled();
  });

  it("compares the two addresses without regard to case", async () => {
    await expect(byToken({ email: INVITED.toUpperCase() })).resolves.toBe("shared");
  });

  it("is refused when the token resolves to nothing", async () => {
    mocks.byToken.mockResolvedValue(undefined);
    await expect(byToken()).resolves.toBeNull();
    expect(mocks.tx).not.toHaveBeenCalled();
  });
});

describe("what one acceptance writes", () => {
  const accept = () =>
    service.accept({ userId: 3, email: INVITED, token: "t", lang: "en" });

  it("marks the invitation and creates the membership together", async () => {
    // A membership without the invitation consumed leaves a link that can be
    // redeemed again; the invitation without the membership grants nothing and
    // cannot be retried.
    await accept();
    expect(mocks.tx).toHaveBeenCalledTimes(1);
    expect(statementsSent()).toEqual(expect.arrayContaining(["accept", "membership"]));
  });

  it("tells the owner in the same transaction", async () => {
    await accept();
    expect(statementsSent()).toContain("notify");
  });

  it("answers null when the invitation had already been accepted", async () => {
    // The guarded insert returns no row on a replay, and reporting success
    // then would hand the caller an access slug for something that did not
    // happen twice.
    mocks.tx.mockResolvedValue([[], []]);
    await expect(accept()).resolves.toBeNull();
  });

  it("still answers with the route a returning member already has", async () => {
    // An existing member can encounter a retried invitation. Their access is
    // real even though nothing new was inserted.
    mocks.tx.mockResolvedValue([[{ id: 5 }], []]);
    mocks.listByUser.mockResolvedValue([
      { project_id: INVITATION.project_id, access_slug: "shared-2" },
    ] as never);
    await expect(accept()).resolves.toBe("shared-2");
  });
});
