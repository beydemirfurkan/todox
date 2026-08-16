import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The recovery path, where the guarantee is which writes travel together.
 *
 * Every statement here has an obvious partial outcome that is a security bug
 * rather than an inconvenience, and none of them is visible from outside: the
 * password does change, the caller is told it worked, and what is missing is
 * something that was supposed to stop being true. So the assertions are about
 * the *set* of statements handed to `tx`, and about the fact that it is one
 * call rather than five.
 *
 * Reaching Postgres is not the point -- `tx` is the seam, and what it is given
 * is the contract.
 */
const mocks = vi.hoisted(() => ({
  tx: vi.fn(),
  resolve: vi.fn(),
  consumeStmt: vi.fn((id: number, consumedAt: string) => ({
    text: "consume",
    params: [id, consumedAt],
  })),
  invalidateAll: vi.fn(),
  createAuthToken: vi.fn(),
  purgeExpired: vi.fn(),
  updatePasswordForConsumedTokenStmt: vi.fn((input: { userId: number }) => ({
    text: "password",
    params: [input.userId],
  })),
  markEmailVerifiedStmt: vi.fn((id: number) => ({ text: "verified", params: [id] })),
  destroySessionsStmt: vi.fn((id: number) => ({ text: "sessions", params: [id] })),
  destroyApiTokensStmt: vi.fn((id: number) => ({ text: "api-tokens", params: [id] })),
  byEmail: vi.fn(),
  send: vi.fn(),
  hashPassword: vi.fn(async () => "hashed"),
}));

vi.mock("../db/client", () => ({ tx: mocks.tx }));
vi.mock("../repositories/auth-tokens", () => ({
  resolve: mocks.resolve,
  consumeStmt: mocks.consumeStmt,
  invalidateAll: mocks.invalidateAll,
  create: mocks.createAuthToken,
  purgeExpired: mocks.purgeExpired,
}));
vi.mock("../repositories/users", () => ({
  byEmail: mocks.byEmail,
  updatePasswordForConsumedTokenStmt: mocks.updatePasswordForConsumedTokenStmt,
  markEmailVerifiedStmt: mocks.markEmailVerifiedStmt,
}));
vi.mock("../repositories/sessions", () => ({
  destroyAllForStmt: mocks.destroySessionsStmt,
  create: vi.fn(),
}));
vi.mock("../repositories/api-tokens", () => ({
  destroyAllForStmt: mocks.destroyApiTokensStmt,
}));
vi.mock("../util/password", () => ({ hashPassword: mocks.hashPassword }));
vi.mock("./mailer", () => ({ send: mocks.send }));

const recovery = await import("./account-recovery");

const USER = {
  id: 7,
  username: "furkan",
  name: "Furkan",
  email: "furkan@example.com",
  email_verified_at: "2026-01-01T00:00:00Z",
};

/** The statements handed to `tx`, by the label each mock stamps on them. */
function statementsSent(): string[] {
  const [batch] = mocks.tx.mock.calls[0] as [{ text: string }[]];
  return batch.map((s) => s.text);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.mockResolvedValue(undefined);
  mocks.resolve.mockResolvedValue({ row: { id: 3 }, user: USER });
});

describe("completing a password reset", () => {
  const run = (password = "a-long-enough-password") =>
    recovery.completePasswordReset("token", password);

  it("refuses a password under the minimum before touching the token", async () => {
    // Otherwise a caller could burn somebody's reset link by submitting
    // rubbish to it.
    const out = await run("short");
    expect(out.ok).toBe(false);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.tx).not.toHaveBeenCalled();
  });

  it("refuses a link that does not resolve, and writes nothing", async () => {
    mocks.resolve.mockResolvedValue(undefined);
    const out = await run();
    expect(out.ok).toBe(false);
    expect(mocks.tx).not.toHaveBeenCalled();
  });

  it("sends every write in one transaction, not one at a time", async () => {
    // These were five independent round trips. Any prefix of them is a state
    // somebody can be left in.
    await run();
    expect(mocks.tx).toHaveBeenCalledTimes(1);
  });

  it("changes the password and consumes the link together", async () => {
    // The password without the token consumed leaves a reset link that still
    // works, held by whoever the account was taken from -- or by whoever took it.
    await run();
    expect(statementsSent()).toEqual(expect.arrayContaining(["password", "consume"]));
  });

  it("drops every session in the same transaction", async () => {
    // Otherwise the owner is told they have recovered the account while the
    // intruder is still signed in.
    await run();
    expect(statementsSent()).toContain("sessions");
  });

  it("drops every agent token too", async () => {
    // An API token never expires and carries full account permissions, so it
    // is exactly what an intruder keeps. Killing sessions and leaving these
    // would be security theatre.
    await run();
    expect(statementsSent()).toContain("api-tokens");
  });

  it("scopes every account-wide write to the account the link belongs to", async () => {
    // Not the token statement: that one is keyed on the row `resolve` found,
    // which is already the account's. Everything else takes an id, and taking
    // the wrong one would sign somebody else out or change their password.
    await run();
    for (const stmt of [mocks.destroySessionsStmt, mocks.destroyApiTokensStmt])
      expect(stmt).toHaveBeenCalledWith(USER.id, ...stmt.mock.calls[0]!.slice(1));
    expect(mocks.updatePasswordForConsumedTokenStmt).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER.id }),
    );
  });

  it("burns the row the link resolved to, not one the caller named", async () => {
    await run();
    expect(mocks.consumeStmt).toHaveBeenCalledWith(3, expect.any(String));
  });

  it("stores a hash, never the password", async () => {
    await run("a-long-enough-password");
    expect(mocks.updatePasswordForConsumedTokenStmt).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER.id, passwordHash: "hashed" }),
    );
    expect(JSON.stringify(mocks.tx.mock.calls)).not.toContain("a-long-enough-password");
  });

  /**
   * Two requests can carry the same link. `resolve` checks `used_at IS NULL`,
   * but that read and this transaction are separate round trips, so both can
   * pass it -- and there is no JavaScript inside `tx` to notice the loser and
   * stop. The consume claims the row, and the password write is the one
   * statement in the list that must not happen twice, so it asks for that claim
   * by name. The rest are safe to repeat.
   */
  it("burns the link before it writes anything else", async () => {
    await run();
    // Ordering is the contract, not an accident of how the list was typed: the
    // password statement looks for a claim the consume has not made yet if it
    // runs first.
    expect(statementsSent()[0]).toBe("consume");
  });

  it("ties the password write to the claim the consume just made", async () => {
    await run();
    const [tokenId, consumedAt] = mocks.consumeStmt.mock.calls[0]!;
    expect(mocks.updatePasswordForConsumedTokenStmt).toHaveBeenCalledWith(
      expect.objectContaining({ tokenId, consumedAt }),
    );
  });

  it("verifies the address, since reaching the inbox proved it", async () => {
    mocks.resolve.mockResolvedValue({
      row: { id: 3 },
      user: { ...USER, email_verified_at: null },
    });
    await run();
    expect(statementsSent()).toContain("verified");
  });

  it("does not re-verify an address that already was", async () => {
    await run();
    expect(statementsSent()).not.toContain("verified");
  });
});

describe("asking for a reset link", () => {
  it("says nothing different for an address nobody has", async () => {
    // Whether an address is registered is not something an unauthenticated
    // caller gets to learn, so there is no branch in the return value.
    mocks.byEmail.mockResolvedValue(undefined);
    await expect(recovery.requestPasswordReset("nobody@example.com", "en")).resolves
      .toBeUndefined();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("retires any earlier link before issuing one", async () => {
    // A leaked older email has to be inert once a newer one is asked for.
    mocks.byEmail.mockResolvedValue(USER);
    await recovery.requestPasswordReset(USER.email, "en");

    const invalidatedAt = mocks.invalidateAll.mock.invocationCallOrder[0]!;
    const createdAt = mocks.createAuthToken.mock.invocationCallOrder[0]!;
    expect(invalidatedAt).toBeLessThan(createdAt);
  });

  it("mails a link the recipient can actually follow", async () => {
    mocks.byEmail.mockResolvedValue(USER);
    await recovery.requestPasswordReset(USER.email, "en");

    const [message] = mocks.send.mock.calls[0] as [{ to: string; text: string }];
    expect(message.to).toBe(USER.email);
    expect(message.text).toContain("/reset?token=");
  });
});

describe("completing a verification", () => {
  it("records the result and burns the link together", async () => {
    // Marking the address verified while leaving the link usable, or burning
    // the link without recording the result, are both worse than failing.
    await expect(recovery.completeVerification("token")).resolves.toBe(true);
    expect(mocks.tx).toHaveBeenCalledTimes(1);
    expect(statementsSent()).toEqual(expect.arrayContaining(["verified", "consume"]));
  });

  it("burns the link first here too, though nothing downstream needs it to", async () => {
    // Verifying an address twice arrives where it was already going, so this
    // ordering buys nothing on its own. It is here so the two recovery paths
    // read the same way -- the next statement added below it will be written by
    // somebody who assumes the claim has been made.
    await recovery.completeVerification("token");
    expect(statementsSent()[0]).toBe("consume");
  });

  it("answers false for a link that does not resolve, and writes nothing", async () => {
    mocks.resolve.mockResolvedValue(undefined);
    await expect(recovery.completeVerification("token")).resolves.toBe(false);
    expect(mocks.tx).not.toHaveBeenCalled();
  });
});
