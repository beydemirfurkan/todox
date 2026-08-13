import { beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "../types";

/**
 * The account boundary.
 *
 * The repositories and scrypt are mocked — what is being pinned is the policy
 * above them: which credential each action costs, what a refusal is allowed to
 * reveal, and what has to happen together or not at all. `password.test.ts`
 * covers the hashing itself with the real implementation.
 */
const usersRepo = vi.hoisted(() => ({
  byId: vi.fn(),
  byLogin: vi.fn(),
  byUsername: vi.fn(),
  byEmail: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  updateEmail: vi.fn(),
  updateProfile: vi.fn(),
  updatePasswordStmt: vi.fn(() => ({ text: "UPDATE users SET password_hash", params: [] })),
}));
const sessionsRepo = vi.hoisted(() => ({
  create: vi.fn(),
  destroy: vi.fn(),
  userForToken: vi.fn(),
  purgeExpired: vi.fn(),
  destroyAllForStmt: vi.fn(() => ({ text: "DELETE FROM sessions", params: [] })),
}));
const apiTokensRepo = vi.hoisted(() => ({
  create: vi.fn(),
  listByUser: vi.fn(),
  remove: vi.fn(),
  destroyAllFor: vi.fn(),
  userForToken: vi.fn(),
}));
const db = vi.hoisted(() => ({ tx: vi.fn() }));
const pw = vi.hoisted(() => ({
  hashPassword: vi.fn(async (p: string) => `hashed:${p}`),
  verifyPassword: vi.fn(),
}));

vi.mock("../repositories/users", () => usersRepo);
vi.mock("../repositories/sessions", () => sessionsRepo);
vi.mock("../repositories/api-tokens", () => apiTokensRepo);
vi.mock("../db/client", () => db);
vi.mock("../util/password", () => pw);
vi.mock("./rate-limit", () => ({ sweep: vi.fn() }));

const auth = await import("./auth");

const USER: User = {
  id: 3,
  username: "bob",
  email: "bob@example.com",
  name: "Bob",
  password_hash: "hashed:right",
  email_verified_at: null,
} as unknown as User;

/** scrypt says yes only for the password this account actually has. */
const passwordIs = (correct: string) =>
  pw.verifyPassword.mockImplementation(async (given: string) => given === correct);

beforeEach(() => {
  vi.clearAllMocks();
  passwordIs("right");
});

describe("publicUser", () => {
  it("drops the password hash", () => {
    // Everything that leaves this module for a page, a cookie or an API
    // response goes through here. A hash that escapes is offline-crackable.
    const shown = auth.publicUser(USER) as Record<string, unknown>;
    expect(shown).not.toHaveProperty("password_hash");
    expect(shown.username).toBe("bob");
  });

  it("is what the session and token lookups return", async () => {
    sessionsRepo.userForToken.mockResolvedValue(USER);
    apiTokensRepo.userForToken.mockResolvedValue(USER);

    expect(await auth.userForSession("t")).not.toHaveProperty("password_hash");
    expect(await auth.userForApiToken("todox_x")).not.toHaveProperty("password_hash");
  });

  it("answers undefined rather than throwing when there is no row", async () => {
    sessionsRepo.userForToken.mockResolvedValue(undefined);
    apiTokensRepo.userForToken.mockResolvedValue(undefined);

    expect(await auth.userForSession("t")).toBeUndefined();
    expect(await auth.userForApiToken("todox_x")).toBeUndefined();
  });
});

describe("login", () => {
  it("accepts the right password", async () => {
    usersRepo.byLogin.mockResolvedValue(USER);

    const result = await auth.login({ identifier: "bob", password: "right" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).not.toHaveProperty("password_hash");
  });

  it("gives an unknown account and a wrong password the same answer", async () => {
    usersRepo.byLogin.mockResolvedValue(undefined);
    const missing = await auth.login({ identifier: "nobody", password: "right" });

    usersRepo.byLogin.mockResolvedValue(USER);
    const wrong = await auth.login({ identifier: "bob", password: "WRONG" });

    // Anything that distinguished them would be a way to test which usernames
    // and addresses have accounts.
    expect(missing).toEqual(wrong);
    expect(missing).toEqual({ ok: false, errors: [{ field: "form", code: "badCredentials" }] });
  });

  it("still runs a verification when no account matched", async () => {
    usersRepo.byLogin.mockResolvedValue(undefined);

    await auth.login({ identifier: "nobody", password: "x" });

    // Skipping it would make a missing account measurably faster than a wrong
    // password, which is the same disclosure by another route.
    expect(pw.verifyPassword).toHaveBeenCalledTimes(1);
    expect(pw.verifyPassword).toHaveBeenCalledWith("x", auth.NO_SUCH_USER_HASH);
  });

  it("trims the identifier, so a trailing space is not a different account", async () => {
    usersRepo.byLogin.mockResolvedValue(USER);

    await auth.login({ identifier: "  bob \n", password: "right" });

    expect(usersRepo.byLogin).toHaveBeenCalledWith("bob");
  });
});

describe("changePassword", () => {
  beforeEach(() => usersRepo.byId.mockResolvedValue(USER));

  it("costs the current password", async () => {
    const result = await auth.changePassword(USER.id, "WRONG", "a-new-password");

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "current", code: "badCredentials" }],
    });
    expect(db.tx).not.toHaveBeenCalled();
  });

  it("refuses a new password under the minimum, before writing anything", async () => {
    const result = await auth.changePassword(USER.id, "right", "short");

    expect(result).toMatchObject({ ok: false, errors: [{ code: "passwordShort" }] });
    expect(db.tx).not.toHaveBeenCalled();
  });

  it("writes the new hash and kills the other sessions in one transaction", async () => {
    // Two statements, one call. A change that reports success while the old
    // sessions survive is worse than one that fails: the owner stops looking
    // for the intruder.
    await auth.changePassword(USER.id, "right", "a-new-password");

    expect(db.tx).toHaveBeenCalledTimes(1);
    expect(usersRepo.updatePasswordStmt).toHaveBeenCalledWith(USER.id, "hashed:a-new-password");
    expect(sessionsRepo.destroyAllForStmt).toHaveBeenCalledWith(USER.id);
    expect((db.tx.mock.calls[0] as [unknown[]])[0]).toHaveLength(2);
  });

  it("hands the repository a hash, and hashes the plaintext to get it", async () => {
    await auth.changePassword(USER.id, "right", "a-new-password");

    // The statement builder takes the hash, not the password. Asserted as
    // "the argument is what hashPassword returned" rather than "the plaintext
    // does not appear", because the fake hash here embeds what it was given.
    expect(pw.hashPassword).toHaveBeenCalledWith("a-new-password");
    const [, hashArg] = usersRepo.updatePasswordStmt.mock.calls[0] as unknown as [
      number,
      string,
    ];
    expect(hashArg).toBe(await pw.hashPassword.mock.results[0]!.value);
  });
});

/**
 * The address is a credential, because the reset flow trusts it.
 *
 * This gate is the fix for a real chain: with only a session cookie required,
 * an attacker pointed the account at an address they controlled, ran forgot
 * password, and took ownership without ever knowing the old password.
 */
describe("changeEmail", () => {
  beforeEach(() => usersRepo.byId.mockResolvedValue(USER));

  it("costs the current password", async () => {
    const result = await auth.changeEmail(USER.id, "WRONG", "new@example.com");

    expect(result).toMatchObject({
      ok: false,
      errors: [{ field: "current", code: "badCredentials" }],
    });
    expect(usersRepo.updateEmail).not.toHaveBeenCalled();
  });

  it("checks the password before it looks at the address at all", async () => {
    // Otherwise "that address is taken" answers a question the caller has not
    // paid for, one address at a time.
    await auth.changeEmail(USER.id, "WRONG", "not-an-address");

    expect(usersRepo.byEmail).not.toHaveBeenCalled();
  });

  it("rejects an address already on another account", async () => {
    usersRepo.byEmail.mockResolvedValue({ ...USER, id: 99 });

    const result = await auth.changeEmail(USER.id, "right", "taken@example.com");

    expect(result).toMatchObject({ ok: false, errors: [{ code: "emailTaken" }] });
    expect(usersRepo.updateEmail).not.toHaveBeenCalled();
  });

  it("accepts the account's own address as a no-op", async () => {
    const result = await auth.changeEmail(USER.id, "right", "BOB@example.com");

    expect(result.ok).toBe(true);
    expect(usersRepo.updateEmail).not.toHaveBeenCalled();
  });

  it("marks the new address unverified", async () => {
    usersRepo.byEmail.mockResolvedValue(undefined);

    const result = await auth.changeEmail(USER.id, "right", "new@example.com");

    if (!result.ok) throw new Error("expected success");
    expect(result.value.user.email_verified_at).toBeNull();
    expect(result.value.previousEmail).toBe("bob@example.com");
  });
});

describe("deleteAccount", () => {
  beforeEach(() => usersRepo.byId.mockResolvedValue(USER));

  it("costs the password, so a stolen cookie cannot destroy the log", async () => {
    const result = await auth.deleteAccount(USER.id, "WRONG", "bob");

    expect(result).toMatchObject({ ok: false, errors: [{ code: "badCredentials" }] });
    expect(usersRepo.remove).not.toHaveBeenCalled();
  });

  it("also wants the username typed, and does not mind the case", async () => {
    // A phone that capitalises the first letter of a text field should not be
    // able to tell somebody their own username is wrong.
    await expect(auth.deleteAccount(USER.id, "right", " BOB ")).resolves.toEqual({
      ok: true,
      value: true,
    });
    expect(usersRepo.remove).toHaveBeenCalledWith(USER.id);
  });

  it("refuses when the confirmation does not match", async () => {
    const result = await auth.deleteAccount(USER.id, "right", "bobby");

    expect(result).toMatchObject({ ok: false, errors: [{ code: "confirmMismatch" }] });
    expect(usersRepo.remove).not.toHaveBeenCalled();
  });
});

describe("register", () => {
  beforeEach(() => {
    usersRepo.byUsername.mockResolvedValue(undefined);
    usersRepo.byEmail.mockResolvedValue(undefined);
    usersRepo.create.mockImplementation(async (u: Record<string, unknown>) => ({
      ...USER,
      ...u,
    }));
  });

  const valid = {
    username: "newbie",
    email: "new@example.com",
    name: "New Person",
    password: "long-enough",
  };

  it("stores a hash, and no field carrying the password itself", async () => {
    await auth.register(valid);

    const stored = usersRepo.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(stored.password_hash).toBe("hashed:long-enough");
    // The row the repository is handed must not carry the plaintext under any
    // name — a `password` that rode along would be written to the column list.
    expect(Object.keys(stored)).not.toContain("password");
    expect(Object.values(stored)).not.toContain(valid.password);
  });

  it("returns a user without the hash", async () => {
    const result = await auth.register(valid);

    if (!result.ok) throw new Error("expected success");
    expect(result.value.user).not.toHaveProperty("password_hash");
  });

  it("refuses a username or address already in use, without creating anything", async () => {
    usersRepo.byUsername.mockResolvedValue(USER);
    await expect(auth.register(valid)).resolves.toMatchObject({
      errors: [{ code: "usernameTaken" }],
    });

    usersRepo.byUsername.mockResolvedValue(undefined);
    usersRepo.byEmail.mockResolvedValue(USER);
    await expect(auth.register(valid)).resolves.toMatchObject({
      errors: [{ code: "emailTaken" }],
    });

    expect(usersRepo.create).not.toHaveBeenCalled();
  });

  it("validates before it touches the database", async () => {
    await auth.register({ ...valid, password: "short" });

    expect(usersRepo.byUsername).not.toHaveBeenCalled();
    expect(usersRepo.create).not.toHaveBeenCalled();
  });
});

describe("validateRegistration", () => {
  const base = {
    username: "bob",
    email: "bob@example.com",
    name: "Bob",
    password: "long-enough",
  };
  const codes = (over: Partial<typeof base>) =>
    auth.validateRegistration({ ...base, ...over }).map((e) => e.code);

  it("accepts a reasonable account", () => {
    expect(codes({})).toEqual([]);
  });

  it("holds the password to the stated minimum", () => {
    expect(auth.MIN_PASSWORD).toBe(8);
    expect(codes({ password: "a".repeat(7) })).toContain("passwordShort");
    expect(codes({ password: "a".repeat(8) })).not.toContain("passwordShort");
  });

  it("rejects usernames that would not survive a URL or a slug", () => {
    for (const username of ["ab", "a".repeat(33), "has space", "has/slash", "eh?", ""]) {
      expect(codes({ username }), username).toContain("usernameFormat");
    }
    for (const username of ["bob", "Bob_99", "a-b-c"]) {
      expect(codes({ username }), username).not.toContain("usernameFormat");
    }
  });

  it("rejects addresses that are obviously not addresses", () => {
    for (const email of ["", "bob", "bob@", "@example.com", "bob@example", "a b@c.com"]) {
      expect(codes({ email }), email).toContain("emailFormat");
    }
  });

  it("wants a name with something in it", () => {
    expect(codes({ name: " " })).toContain("nameRequired");
    expect(codes({ name: "X" })).toContain("nameRequired");
    expect(codes({ name: "Xy" })).not.toContain("nameRequired");
  });

  it("reports every problem at once, not the first one", () => {
    // One round trip per mistake is a bad form to fill in.
    expect(codes({ username: "!", email: "no", name: "", password: "x" })).toHaveLength(4);
  });
});

describe("api tokens", () => {
  it("hands back the plaintext once, with a preview that is not the token", async () => {
    apiTokensRepo.create.mockImplementation(async (row: Record<string, unknown>) => row);

    const { token, preview } = await auth.createApiToken(USER.id, "laptop");

    expect(token.startsWith("todox_")).toBe(true);
    expect(preview).not.toBe(token);
    expect(preview).toContain("…");
  });

  it("scopes a revoke to the account, so an id from elsewhere is not enough", async () => {
    await auth.revokeApiToken(11, USER.id);

    expect(apiTokensRepo.remove).toHaveBeenCalledWith(11, USER.id);
  });
});
