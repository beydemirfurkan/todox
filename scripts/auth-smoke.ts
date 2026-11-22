/**
 * Exercises the account-safety work: rate limiting, password reset, email
 * verification, and the guarantees each is supposed to give.
 *
 * Talks to the services directly -- these paths are server-side logic, and
 * driving them through forms would test Next's plumbing rather than the rules.
 */
import "./env";

import { localDatabaseOnly } from "./local-only";

localDatabaseOnly("smoke:auth");

import { one, run, tx } from "../lib/db/client";
import * as apiTokensRepo from "../lib/repositories/api-tokens";
import * as authTokensRepo from "../lib/repositories/auth-tokens";
import * as sessionsRepo from "../lib/repositories/sessions";
import * as usersRepo from "../lib/repositories/users";
import {
  completePasswordReset,
  completeVerification,
  requestPasswordReset,
  sendEmailChanged,
  sendVerification,
} from "../lib/services/account-recovery";
import { changeEmail, changePassword, issueSession, login, register } from "../lib/services/auth";
import * as oauthAccountsRepo from "../lib/repositories/oauth-accounts";
import { issueLinkGrant, resolveSignIn, unlink } from "../lib/services/oauth";
import * as limit from "../lib/services/rate-limit";
import { hashToken } from "../lib/util/tokens";

const USER = {
  username: "auth-smoke",
  email: "auth-smoke@todox.local",
  name: "Auth Smoke",
  password: "correct-horse",
};

const line = (s: string) => console.log(`\n--- ${s} ---`);

let failures = 0;
const expect = (label: string, pass: boolean) => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
};

/** The plaintext only ever exists in the email, so tests issue their own
 *  tokens through the repository and compare against the stored hash. */
const latestHash = (userId: number, purpose: "reset" | "verify") =>
  one<{ token_hash: string }>(
    `SELECT token_hash FROM auth_tokens
     WHERE user_id = ? AND purpose = ? ORDER BY id DESC LIMIT 1`,
    [userId, purpose],
  );

const issueRaw = async (userId: number, purpose: "reset" | "verify", token: string) => {
  await authTokensRepo.invalidateAll(userId, purpose);
  await authTokensRepo.create({
    user_id: userId,
    purpose,
    token,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  return token;
};

const rnd = (p: string) => `${p}-${Math.random().toString(36).slice(2)}`;

/** Read back through SQL: the repository has no getter for either of these,
 *  and both are exactly what the race check needs to see. */
const storedHash = async (userId: number) =>
  (await one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", [userId]))
    ?.password_hash;

const usedAt = async (tokenId: number) =>
  (await one<{ used_at: string | null }>("SELECT used_at FROM auth_tokens WHERE id = ?", [tokenId]))
    ?.used_at;

async function countResetTokens() {
  const row = await one<{ n: string }>(
    "SELECT COUNT(*) AS n FROM auth_tokens WHERE purpose = 'reset'",
  );
  return Number(row?.n ?? 0);
}

async function main() {
  // start from nothing
  const stale = await usersRepo.byUsername(USER.username);
  if (stale) await run("DELETE FROM users WHERE id = ?", [stale.id]);
  await limit.forgive("loginPerIdentity", USER.username);
  await limit.forgive("resetPerEmail", USER.email);

  line("registration issues a verification link");
  const reg = await register(USER);
  if (!reg.ok) throw new Error("registration failed: " + JSON.stringify(reg.errors));
  const user = reg.value.user;
  await sendVerification(user, "en");
  expect("account starts unverified", user.email_verified_at === null);
  expect("a verify token exists", Boolean(await latestHash(user.id, "verify")));

  line("verification link works exactly once");
  const verifyToken = await issueRaw(user.id, "verify", rnd("verify"));
  const storedVerify = await latestHash(user.id, "verify");
  expect(
    "token hash matches what is stored",
    storedVerify?.token_hash === hashToken(verifyToken),
  );
  expect("first use verifies", await completeVerification(verifyToken));
  expect("second use is rejected", (await completeVerification(verifyToken)) === false);
  expect("user is now verified", Boolean((await usersRepo.byId(user.id))?.email_verified_at));

  line("login rate limit counts failures, not successes");
  for (let i = 0; i < 10; i++) await limit.penalise("loginPerIdentity", USER.username);
  expect(
    "locked out after repeated failures",
    (await limit.check("loginPerIdentity", USER.username)).allowed === false,
  );
  await limit.forgive("loginPerIdentity", USER.username);
  expect(
    "a success clears the counter",
    (await limit.check("loginPerIdentity", USER.username)).allowed === true,
  );

  line("password reset never reveals whether an address exists");
  // Count the delta, not the total: other accounts may legitimately have
  // reset tokens sitting in the table.
  const before = await countResetTokens();
  await requestPasswordReset("nobody@todox.local", "en");
  expect("no token issued for an unknown address", (await countResetTokens()) === before);

  line("reset invalidates sessions and old links");
  const liveSession = await issueSession(user.id, "smoke");
  expect(
    "session is live before reset",
    Boolean(await sessionsRepo.userForToken(liveSession)),
  );

  const firstReset = await issueRaw(user.id, "reset", rnd("reset"));
  const secondReset = await issueRaw(user.id, "reset", rnd("reset"));

  expect(
    "a superseded link stops working",
    (await completePasswordReset(firstReset, "new-password-1")).ok === false,
  );
  expect(
    "short passwords are refused",
    (await completePasswordReset(secondReset, "short")).ok === false,
  );
  expect(
    "the current link resets the password",
    (await completePasswordReset(secondReset, "brand-new-password")).ok === true,
  );
  expect(
    "every session died with it",
    !(await sessionsRepo.userForToken(liveSession)),
  );

  expect(
    "old password no longer works",
    (await login({ identifier: USER.username, password: USER.password })).ok === false,
  );
  expect(
    "new password works",
    (await login({ identifier: USER.username, password: "brand-new-password" })).ok ===
      true,
  );
  expect(
    "reset link is single use",
    (await completePasswordReset(secondReset, "another-one")).ok === false,
  );

  line("two requests racing one link change the password once");
  // The check above is the sequential case, and `resolve` catches that on its
  // own. This is the one it cannot: `resolve` and the transaction are separate
  // round trips, so two requests carrying the same link can both pass the
  // `used_at IS NULL` read before either writes. There is no JavaScript inside
  // `tx()` to spot the loser and stop, so the writes carry the condition.
  //
  // Driven through the statements rather than by firing two requests at once,
  // because a race you have to win a coin toss to observe is not a check. What
  // the second transaction here does is exactly what a losing racer does.
  const raced = await issueRaw(user.id, "reset", rnd("reset"));
  const racedRow = await one<{ id: number }>(
    "SELECT id FROM auth_tokens WHERE token_hash = ?",
    [hashToken(raced)],
  );
  if (!racedRow) throw new Error("the token just issued is not there");

  const attempt = async (passwordHash: string, consumedAt: string) =>
    tx([
      authTokensRepo.consumeStmt(racedRow.id, consumedAt),
      usersRepo.updatePasswordForConsumedTokenStmt({
        userId: user.id,
        passwordHash,
        tokenId: racedRow.id,
        consumedAt,
      }),
    ]);

  const winnerAt = new Date().toISOString();
  await attempt("winner-hash", winnerAt);
  expect("the request that claims the link sets the password", (await storedHash(user.id)) === "winner-hash");

  await attempt("loser-hash", new Date(Date.now() + 1).toISOString());
  expect("the one that lost the claim writes nothing", (await storedHash(user.id)) === "winner-hash");
  expect("and the link stays burned by the winner", (await usedAt(racedRow.id)) === winnerAt);

  line("a reset revokes agent tokens, not just sessions");
  // A token that never expires and carries the whole account is exactly what
  // an intruder keeps. Killing sessions and leaving these would be theatre.
  await apiTokensRepo.create({ user_id: user.id, name: "smoke", token: rnd("todox") });
  expect("token exists before reset", (await apiTokensRepo.listByUser(user.id)).length === 1);
  const thirdReset = await issueRaw(user.id, "reset", rnd("reset"));
  await completePasswordReset(thirdReset, "another-good-password");
  expect(
    "tokens died with the reset",
    (await apiTokensRepo.listByUser(user.id)).length === 0,
  );

  line("changing the email costs the password");
  const wrong = await changeEmail(user.id, "not-the-password", "moved@todox.local");
  expect("refused without the current password", wrong.ok === false);
  expect(
    "address unchanged after a refusal",
    (await usersRepo.byId(user.id))?.email === USER.email,
  );

  const badFormat = await changeEmail(user.id, "another-good-password", "not-an-address");
  expect("refused a malformed address", badFormat.ok === false);

  // A reset link mailed to the old address, and two sessions: the one making
  // the change and one somebody else holds.
  await requestPasswordReset(USER.email, "en");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const keep = await issueSession(user.id);
  const other = await issueSession(user.id);
  const moved = await changeEmail(user.id, "another-good-password", "moved@todox.local", keep);
  expect(
    "the reset link sent before the change is retired with it",
    Number(
      (
        await one<{ n: number }>(
          "SELECT count(*)::int AS n FROM auth_tokens WHERE user_id = ? AND purpose = 'reset' AND used_at IS NULL",
          [user.id],
        )
      )?.n,
    ) === 0,
  );
  expect("this session survives the change", Boolean(await sessionsRepo.userForToken(keep)));
  expect("every other session ends", !(await sessionsRepo.userForToken(other)));
  expect("accepted with the current password", moved.ok === true);
  expect(
    "verification cleared",
    (await usersRepo.byId(user.id))?.email_verified_at === null,
  );
  if (moved.ok) {
    expect("reports the previous address", moved.value.previousEmail === USER.email);
    await sendVerification(moved.value.user, "en");
    await sendEmailChanged(moved.value.previousEmail, moved.value.user, "en");
  }

  await run("DELETE FROM users WHERE id = ?", [user.id]);
  await oauthCases();
  await limit.sweep();

  console.log(failures === 0 ? "\nOK (cleaned up)" : `\n${failures} FAILURE(S)`);
  if (failures) process.exit(1);
}

/**
 * Google and GitHub sign-in against the real schema: the CTE that makes an
 * account and its identity together, the unique constraints the service
 * reads refusals from, and the statement that refuses to unlink the last way
 * in. The provider itself is not called; a profile stands in for what it said.
 */
async function oauthCases() {
  line("signing in with a provider");
  const profile = {
    providerUserId: "smoke-gh-1",
    email: "oauth-smoke@todox.local",
    isEmailVerified: true,
    name: "OAuth Smoke",
    usernameHint: "oauth-smoke",
  };
  await run("DELETE FROM users WHERE lower(email) IN (lower(?), lower(?))", [
    profile.email,
    "oauth-victim@todox.local",
  ]);

  const created = await resolveSignIn({ provider: "github", profile, currentUserId: null });
  expect("a new identity makes an account", created.ok && created.how === "created");
  if (!created.ok) return;
  const made = await usersRepo.byId(created.userId);
  expect("with no password", made?.password_hash === null);
  expect("and the address marked verified", Boolean(made?.email_verified_at));
  expect(
    "the identity row was written with it",
    (await oauthAccountsRepo.listForUser(created.userId)).length === 1,
  );

  const again = await resolveSignIn({ provider: "github", profile, currentUserId: null });
  expect("the same identity lands on the same account", again.ok && again.userId === created.userId);

  const noPassword = await login({ identifier: profile.email, password: "" });
  expect("an empty password does not sign it in", noPassword.ok === false);

  expect("its only way in cannot be unlinked", (await unlink(created.userId, "github")) === false);

  const session = await issueSession(created.userId);
  const setFirst = await changePassword(created.userId, "", "a-first-password", session);
  expect("a fresh session sets a first password", setFirst.ok === true);
  expect("then the identity can be unlinked", (await unlink(created.userId, "github")) === true);

  line("an address a provider has not verified");
  const victim = await register({
    username: "oauth-victim",
    email: "oauth-victim@todox.local",
    name: "Victim",
    password: "victim-password",
  });
  if (victim.ok) {
    const claim = await resolveSignIn({
      provider: "google",
      profile: { ...profile, providerUserId: "smoke-g-9", email: "oauth-victim@todox.local", isEmailVerified: false },
      currentUserId: null,
    });
    expect("does not reach the existing account", claim.ok === false);
    expect(
      "and links nothing to it",
      (await oauthAccountsRepo.listForUser(victim.value.user.id)).length === 0,
    );

    line("an unverified account the provider's verified owner arrives at");
    // The squatter registered first and holds a password and a session.
    const squatterSession = await issueSession(victim.value.user.id);
    const owner = await resolveSignIn({
      provider: "google",
      profile: { ...profile, providerUserId: "smoke-g-10", email: "oauth-victim@todox.local", isEmailVerified: true },
      currentUserId: null,
    });
    expect("the owner gets the account", owner.ok && owner.userId === victim.value.user.id);
    const taken = await usersRepo.byId(victim.value.user.id);
    expect("the squatter's password is gone", taken?.password_hash === null);
    expect("the address is now verified", Boolean(taken?.email_verified_at));
    expect("the squatter's session is gone", !(await sessionsRepo.userForToken(squatterSession)));

    line("connecting a provider from a signed-in account");
    const noGrant = await resolveSignIn({
      provider: "github",
      profile: { ...profile, providerUserId: "smoke-gh-11", email: null },
      currentUserId: victim.value.user.id,
    });
    expect("a session alone cannot connect one", !noGrant.ok && noGrant.code === "oauthLinkExpired");
    const grant = await issueLinkGrant(victim.value.user.id);
    const linked = await resolveSignIn({
      provider: "github",
      profile: { ...profile, providerUserId: "smoke-gh-11", email: null },
      currentUserId: victim.value.user.id,
      linkGrant: grant,
    });
    expect("a grant connects it", linked.ok && linked.how === "linked");
    const replay = await resolveSignIn({
      provider: "github",
      profile: { ...profile, providerUserId: "smoke-gh-12", email: null },
      currentUserId: victim.value.user.id,
      linkGrant: grant,
    });
    expect("and is spent doing so", !replay.ok && replay.code === "oauthLinkExpired");
  }

  await run("DELETE FROM users WHERE lower(email) IN (lower(?), lower(?))", [
    profile.email,
    "oauth-victim@todox.local",
  ]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
