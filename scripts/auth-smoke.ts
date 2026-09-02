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
import { changeEmail, issueSession, login, register } from "../lib/services/auth";
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

  const moved = await changeEmail(user.id, "another-good-password", "moved@todox.local");
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
  await limit.sweep();

  console.log(failures === 0 ? "\nOK (cleaned up)" : `\n${failures} FAILURE(S)`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
