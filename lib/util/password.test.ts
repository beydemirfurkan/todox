import { afterEach, describe, expect, it, vi } from "vitest";

import { NO_SUCH_USER_HASH } from "../services/auth";
import { hashPassword, verifyPassword } from "./password";

/**
 * Real scrypt, not a mock: the parameters and the encoding are the thing being
 * checked, and a fake would agree with whatever the code did.
 *
 * The cases that matter are the ones where being wrong is quiet. A record this
 * cannot read has to answer false — an unverifiable credential is not a
 * verified one — and it used to throw instead, which on the login path would
 * have turned an unknown account into a 500 beside a wrong password's 401.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

describe("hashPassword", () => {
  it("round-trips the password it was given", async () => {
    const stored = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", stored)).resolves.toBe(true);
  });

  it("rejects a password that is close but not equal", async () => {
    const stored = await hashPassword("hunter2");
    for (const wrong of ["hunter3", "hunter", "hunter2 ", "Hunter2", ""]) {
      await expect(verifyPassword(wrong, stored), wrong).resolves.toBe(false);
    }
  });

  it("salts, so the same password hashes differently every time", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
    // And both still verify, which is what proves the difference is the salt.
    await expect(verifyPassword("same", a)).resolves.toBe(true);
    await expect(verifyPassword("same", b)).resolves.toBe(true);
  });

  it("writes the parameters into the record, so they can be raised later", async () => {
    const [scheme, n, r, p, salt, hash] = (await hashPassword("x")).split("$");
    expect(scheme).toBe("scrypt");
    expect([n, r, p]).toEqual(["16384", "8", "1"]);
    expect(Buffer.from(salt!, "base64")).toHaveLength(16);
    expect(Buffer.from(hash!, "base64")).toHaveLength(64);
  });

  it("verifies against the record's own parameters, not today's", async () => {
    // The point of storing them: a record written under a lower cost has to
    // keep working after the constant is raised, or raising it locks everyone
    // out of their account.
    const stored = await hashPassword("legacy");
    const [, , , , salt, hash] = stored.split("$");
    const cheaper = ["scrypt", 1024, 8, 1, salt, hash].join("$");
    // Different N than the hash was made with, so it must not match…
    await expect(verifyPassword("legacy", cheaper)).resolves.toBe(false);
    // …while the record that names its own N still does.
    await expect(verifyPassword("legacy", stored)).resolves.toBe(true);
  });
});

describe("a record verifyPassword cannot read", () => {
  const UNREADABLE = [
    ["another scheme", "bcrypt$2b$10$abcdefghijklmnopqrstuv"],
    ["not a record at all", "garbage"],
    ["empty", ""],
    ["truncated after the cost", "scrypt$16384"],
    ["missing salt and hash", "scrypt$16384$8$1"],
    ["missing the hash", "scrypt$16384$8$1$AAAA"],
    ["empty hash", "scrypt$16384$8$1$AAAA$"],
    ["non-numeric cost", "scrypt$abc$8$1$AAAA$AAAA"],
    ["zero cost", "scrypt$0$8$1$AAAA$AAAA"],
    ["negative cost", "scrypt$-1$8$1$AAAA$AAAA"],
  ] as const;

  for (const [label, stored] of UNREADABLE) {
    it(`answers false for ${label}, and does not throw`, async () => {
      await expect(verifyPassword("hunter2", stored)).resolves.toBe(false);
    });
  }

  it("says so in the log when a record is shaped right but unusable", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // N must be a power of two; scrypt rejects this one, and a stored record
    // that cannot be derived from is corruption worth seeing.
    await expect(verifyPassword("hunter2", "scrypt$3$8$1$AAAA$AAAA")).resolves.toBe(false);

    expect(logged).toHaveBeenCalled();
    const said = logged.mock.calls.flat().join(" ");
    expect(said).not.toContain("hunter2");
  });
});

/**
 * `login` verifies against this when no account matches, purely so the two
 * paths cost the same. Everything about it has to hold or that defence is
 * decoration.
 */
describe("NO_SUCH_USER_HASH", () => {
  it("is a record verifyPassword can actually read", async () => {
    // If it were unreadable, verification would return early and the whole
    // point — equal work for a missing account — would be lost.
    const [scheme, n, r, p, salt, hash] = NO_SUCH_USER_HASH.split("$");
    expect(scheme).toBe("scrypt");
    expect([n, r, p]).toEqual(["16384", "8", "1"]);
    expect(Buffer.from(salt!, "base64").length).toBeGreaterThan(0);
    expect(Buffer.from(hash!, "base64")).toHaveLength(64);
  });

  it("uses the same cost as a real record, or the timing gives it away", async () => {
    const real = await hashPassword("x");
    expect(NO_SUCH_USER_HASH.split("$").slice(1, 4)).toEqual(real.split("$").slice(1, 4));
  });

  it("matches nothing", async () => {
    for (const guess of ["", "password", "A".repeat(88), "hunter2"]) {
      await expect(verifyPassword(guess, NO_SUCH_USER_HASH), guess).resolves.toBe(false);
    }
  });
});
