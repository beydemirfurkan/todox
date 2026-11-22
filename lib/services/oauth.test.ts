import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OAuthProfile } from "./oauth-providers";

/**
 * The four ways a Google or GitHub sign-in can land, with the repositories
 * mocked: what is pinned is which account an identity may reach, and that a
 * provider's unverified claim about an address never reaches an existing one.
 */
const oauthRepo = vi.hoisted(() => ({
  OAUTH_PROVIDERS: ["google", "github"],
  byIdentity: vi.fn(),
  createStmt: vi.fn((input: unknown) => ({ text: "INSERT INTO oauth_accounts", params: [input] })),
  createUserWithIdentity: vi.fn(),
  removeUnlessLast: vi.fn(),
}));
const usersRepo = vi.hoisted(() => ({ byEmail: vi.fn(), byUsername: vi.fn() }));
const db = vi.hoisted(() => ({ runStmt: vi.fn() }));

vi.mock("../repositories/oauth-accounts", () => oauthRepo);
vi.mock("../repositories/users", () => usersRepo);
vi.mock("../db/client", () => db);
vi.mock("../server/log", () => ({ logInfo: vi.fn() }));

const { resolveSignIn, unlink, usernameBase, usernameCandidate } = await import("./oauth");

const PROFILE: OAuthProfile = {
  providerUserId: "gh-42",
  email: "ada@example.com",
  isEmailVerified: true,
  name: "Ada",
  usernameHint: "ada",
};

const signIn = (profile: Partial<OAuthProfile> = {}, currentUserId: number | null = null) =>
  resolveSignIn({ provider: "github", profile: { ...PROFILE, ...profile }, currentUserId });

beforeEach(() => {
  vi.clearAllMocks();
  oauthRepo.byIdentity.mockResolvedValue(undefined);
  usersRepo.byEmail.mockResolvedValue(undefined);
  usersRepo.byUsername.mockReset().mockResolvedValue(undefined);
  db.runStmt.mockReset().mockResolvedValue(1);
});

describe("an identity that is already linked", () => {
  it("signs in as its account", async () => {
    oauthRepo.byIdentity.mockResolvedValue({ user_id: 7 });
    expect(await signIn()).toEqual({ ok: true, userId: 7, how: "signed_in" });
    expect(db.runStmt).not.toHaveBeenCalled();
  });

  it("is refused when somebody else is signed in here", async () => {
    oauthRepo.byIdentity.mockResolvedValue({ user_id: 7 });
    expect(await signIn({}, 9)).toEqual({ ok: false, code: "oauthLinkedElsewhere" });
  });

  it("is a re-confirmation when it is the signed-in account's own", async () => {
    oauthRepo.byIdentity.mockResolvedValue({ user_id: 9 });
    expect(await signIn({}, 9)).toEqual({ ok: true, userId: 9, how: "linked" });
  });
});

describe("connecting from the account page", () => {
  it("links the identity to whoever is signed in, whatever its address", async () => {
    const result = await signIn({ email: null, isEmailVerified: false }, 9);
    expect(result).toEqual({ ok: true, userId: 9, how: "linked" });
    expect(oauthRepo.createStmt).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 9, provider: "github", providerUserId: "gh-42" }),
    );
  });

  it("is refused when the account already has another identity from that provider", async () => {
    db.runStmt.mockRejectedValue(Object.assign(new Error("duplicate"), { code: "23505" }));
    expect(await signIn({}, 9)).toEqual({ ok: false, code: "oauthProviderTaken" });
  });

  it("does not swallow other database failures", async () => {
    db.runStmt.mockRejectedValue(new Error("connection reset"));
    await expect(signIn({}, 9)).rejects.toThrow("connection reset");
  });
});

describe("an address that already has an account", () => {
  it("links and signs in when the provider verified the address", async () => {
    usersRepo.byEmail.mockResolvedValue({ id: 4 });
    expect(await signIn()).toEqual({ ok: true, userId: 4, how: "signed_in" });
    expect(oauthRepo.createStmt).toHaveBeenCalledWith(expect.objectContaining({ userId: 4 }));
  });

  it("is refused, and nothing is linked, when the provider did not", async () => {
    usersRepo.byEmail.mockResolvedValue({ id: 4 });
    expect(await signIn({ isEmailVerified: false })).toEqual({
      ok: false,
      code: "oauthEmailUnverified",
    });
    expect(db.runStmt).not.toHaveBeenCalled();
    expect(oauthRepo.createUserWithIdentity).not.toHaveBeenCalled();
  });
});

describe("a new account", () => {
  it("is made with no password and the provider's verification", async () => {
    oauthRepo.createUserWithIdentity.mockResolvedValue({ id: 11 });
    expect(await signIn()).toEqual({ ok: true, userId: 11, how: "created" });
    expect(oauthRepo.createUserWithIdentity).toHaveBeenCalledWith({
      username: "ada",
      email: "ada@example.com",
      name: "Ada",
      isEmailVerified: true,
      provider: "github",
      providerUserId: "gh-42",
    });
  });

  it("takes the next username when the first is taken", async () => {
    usersRepo.byUsername.mockImplementation(async (name: string) => (name === "ada" ? { id: 1 } : undefined));
    oauthRepo.createUserWithIdentity.mockResolvedValue({ id: 11 });
    await signIn();
    expect(oauthRepo.createUserWithIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ username: "ada-2" }),
    );
  });

  it("falls back to the username when the provider has no name", async () => {
    oauthRepo.createUserWithIdentity.mockResolvedValue({ id: 11 });
    await signIn({ name: "  " });
    expect(oauthRepo.createUserWithIdentity).toHaveBeenCalledWith(expect.objectContaining({ name: "ada" }));
  });

  it("is refused without an address", async () => {
    expect(await signIn({ email: null })).toEqual({ ok: false, code: "oauthNoEmail" });
    expect(oauthRepo.createUserWithIdentity).not.toHaveBeenCalled();
  });

  it("gives up when the address was taken between the check and the insert", async () => {
    oauthRepo.createUserWithIdentity.mockResolvedValue(undefined);
    usersRepo.byEmail.mockResolvedValueOnce(undefined).mockResolvedValue({ id: 4 });
    expect(await signIn()).toEqual({ ok: false, code: "oauthFailed" });
    expect(oauthRepo.createUserWithIdentity).toHaveBeenCalledTimes(1);
  });
});

describe("usernames from a provider", () => {
  it("fits the registration rule", () => {
    expect(usernameBase("Ayşe.Yılmaz")).toBe("ayse-yilmaz");
    expect(usernameBase("octo_cat")).toBe("octo_cat");
    expect(usernameBase("a")).toBe("user-a");
    expect(usernameBase("")).toBe("user");
    expect(usernameBase("x".repeat(60))).toHaveLength(24);
    for (const hint of ["Ayşe.Yılmaz", "a", "", "--", "日本"]) {
      expect(usernameBase(hint)).toMatch(/^[a-z0-9_-]{3,32}$/);
    }
  });

  it("numbers, then randomises", () => {
    expect(usernameCandidate("ada", 0)).toBe("ada");
    expect(usernameCandidate("ada", 1)).toBe("ada-2");
    expect(usernameCandidate("ada", 4)).toMatch(/^ada-[0-9a-f]{6}$/);
  });
});

describe("unlink", () => {
  it("reports whether the last way in was kept", async () => {
    oauthRepo.removeUnlessLast.mockResolvedValue(0);
    expect(await unlink(3, "google")).toBe(false);
    oauthRepo.removeUnlessLast.mockResolvedValue(1);
    expect(await unlink(3, "google")).toBe(true);
  });
});
