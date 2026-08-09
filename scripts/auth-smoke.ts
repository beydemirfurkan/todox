/**
 * Exercises the account-safety work: rate limiting, password reset, email
 * verification, and the guarantees each is supposed to give.
 *
 * Talks to the services directly -- these paths are server-side logic, and
 * driving them through forms would test Next's plumbing rather than the rules.
 */
import "./env";

import { one, run } from "../lib/db/client";
import * as authTokensRepo from "../lib/repositories/auth-tokens";
import * as sessionsRepo from "../lib/repositories/sessions";
import * as usersRepo from "../lib/repositories/users";
import {
  completePasswordReset,
  completeVerification,
  requestPasswordReset,
  sendVerification,
} from "../lib/services/account-recovery";
import { issueSession, login, publicUser, register } from "../lib/services/auth";
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

  line("changing the email un-verifies it");
  await usersRepo.updateEmail(user.id, "moved@todox.local");
  const moved = await usersRepo.byId(user.id);
  expect("verification cleared", moved?.email_verified_at === null);
  await sendVerification(publicUser(moved!), "en");

  await run("DELETE FROM users WHERE id = ?", [user.id]);
  await limit.sweep();

  console.log(failures === 0 ? "\nOK (cleaned up)" : `\n${failures} FAILURE(S)`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
